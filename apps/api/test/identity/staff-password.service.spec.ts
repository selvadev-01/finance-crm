import type { PrismaClient, StaffRole } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { completePasswordChange } from '../../src/auth/password-change.js';
import { PasswordHasher } from '../../src/identity/password-hasher.js';
import { StaffPasswordService } from '../../src/identity/staff-password.service.js';
import { generateTemporaryPassword } from '../../src/identity/temporary-password.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { testRecorder } from '../security/recorder.js';
import { withRollback } from '../with-rollback.js';

/**
 * Admin-initiated password reset (US-003) against real rows, rolled back — so
 * the real audit rows, credential and sessions can be inspected.
 */
describe('StaffPasswordService (US-003)', () => {
  let prisma: PrismaClient;
  const hasher = new PasswordHasher();

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient, actorRole: StaffRole = 'ADMIN') {
    const { organization } = await createLine(tx);
    const actor = await createStaff(tx, organization.id, 'SENIOR');
    await tx.staffProfile.update({
      where: { id: actor.id },
      data: { role: actorRole },
    });
    const context: RequestContext = {
      requestId: 'req_test',
      userId: actor.userId,
      staffProfileId: actor.id,
      organizationId: organization.id,
      role: actorRole,
      currentLineId: null,
    };
    const database = new Database(tx);
    const service = new StaffPasswordService(
      database,
      new AuditWriter(database),
      hasher,
      testRecorder(tx, {
        route: {
          method: 'POST',
          path: '/api/staff/:staffProfileId/password-reset',
        },
      }),
    );

    /** A staff member with a real password credential and two signed-in devices. */
    const target = async (role: StaffRole = 'JUNIOR') => {
      const staff = await createStaff(tx, organization.id, 'JUNIOR');
      await tx.staffProfile.update({ where: { id: staff.id }, data: { role } });
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: staff.userId,
          providerId: 'credential',
          userId: staff.userId,
          password: await hasher.hash('the-old-password'),
        },
      });
      for (let device = 0; device < 2; device += 1) {
        await tx.session.create({
          data: {
            id: randomUUID(),
            token: randomUUID(),
            userId: staff.userId,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      }
      return staff;
    };
    return { context, service, target, organization };
  }

  it('sets a new password that verifies, revokes every session, and requires a change', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx);
      const junior = await target();

      const result = await service.resetPassword(context, junior.id);

      expect(result.sessionsRevoked).toBe(2);
      expect(await tx.session.count({ where: { userId: junior.userId } })).toBe(
        0,
      );
      const credential = await tx.account.findFirstOrThrow({
        where: { userId: junior.userId, providerId: 'credential' },
      });
      expect(
        await hasher.verify(credential.password!, result.temporaryPassword),
      ).toBe(true);
      expect(
        await hasher.verify(credential.password!, 'the-old-password'),
      ).toBe(false);
      expect(
        (await tx.staffProfile.findUniqueOrThrow({ where: { id: junior.id } }))
          .mustChangePassword,
      ).toBe(true);
    });
  });

  it('audits the reset without the temporary password anywhere in the row', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx);
      const junior = await target();

      const { temporaryPassword } = await service.resetPassword(
        context,
        junior.id,
      );

      const row = await tx.auditLog.findFirstOrThrow({
        where: { entityId: junior.id, entityTable: 'staff_profile' },
      });
      expect(row).toMatchObject({
        action: 'UPDATE',
        actorUserId: context.userId,
        after: {
          mustChangePassword: true,
          passwordReset: true,
          sessionsRevoked: 2,
        },
      });
      expect(JSON.stringify(row)).not.toContain(temporaryPassword);
    });
  });

  it('an Admin cannot reset a Super Admin (403); a Super Admin can', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx, 'ADMIN');
      const owner = await target('SUPER_ADMIN');
      await expect(
        service.resetPassword(context, owner.id),
      ).rejects.toMatchObject({
        code: 'CANNOT_RESET_SUPER_ADMIN',
        status: 403,
      });

      const asOwner: RequestContext = { ...context, role: 'SUPER_ADMIN' };
      await expect(
        service.resetPassword(asOwner, owner.id),
      ).resolves.toMatchObject({
        sessionsRevoked: 2,
      });
    });
  });

  it('records the attempt on the owner, and the guess at a staff id (ADR-0014)', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx, 'ADMIN');
      const owner = await target('SUPER_ADMIN');
      // Reaching for the owner's account by forcing a reset is the takeover
      // the rank guard exists to stop, so the owner must be able to see it.
      await expect(service.resetPassword(context, owner.id)).rejects.toThrow();
      await expect(
        service.resetPassword(context, randomUUID()),
      ).rejects.toThrow();

      const events = await tx.securityEvent.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: 'asc' },
      });
      expect(events).toMatchObject([
        {
          kind: 'RANK_GUARD',
          code: 'CANNOT_RESET_SUPER_ADMIN',
          status: 403,
          actorUserId: context.userId,
          actorRole: 'ADMIN',
          targetTable: 'staff_profile',
          targetId: owner.id,
          path: '/api/staff/:staffProfileId/password-reset',
          method: 'POST',
        },
        { kind: 'OUT_OF_SCOPE', code: 'STAFF_NOT_FOUND', status: 404 },
      ]);
      // The temporary password is never generated on a refusal, but prove the
      // row carries nothing from the attempt beyond who, what and against whom.
      expect(Object.keys(events[0]!.detail ?? {})).toEqual([]);
    });
  });

  it('refuses a reset of your own password (422)', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service } = await world(tx);
      await expect(
        service.resetPassword(context, context.staffProfileId),
      ).rejects.toMatchObject({
        code: 'CANNOT_RESET_OWN_PASSWORD',
        status: 422,
      });
    });
  });

  it('answers 404 for staff in another organization or soft-deleted', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx);
      const elsewhere = await createLine(tx);
      const theirs = await createStaff(tx, elsewhere.organization.id, 'JUNIOR');
      const deleted = await target();
      await tx.staffProfile.update({
        where: { id: deleted.id },
        data: { deletedAt: new Date() },
      });

      for (const id of [theirs.id, deleted.id]) {
        await expect(service.resetPassword(context, id)).rejects.toMatchObject({
          code: 'STAFF_NOT_FOUND',
          status: 404,
        });
      }
    });
  });

  it('completing the forced change clears the flag and audits it, in one batch', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx);
      const junior = await target();
      await service.resetPassword(context, junior.id);

      await completePasswordChange(tx, junior.userId);

      expect(
        (await tx.staffProfile.findUniqueOrThrow({ where: { id: junior.id } }))
          .mustChangePassword,
      ).toBe(false);
      expect(
        await tx.auditLog.findFirst({
          where: {
            entityId: junior.id,
            after: {
              equals: { mustChangePassword: false, passwordChanged: true },
            },
          },
        }),
      ).toMatchObject({ actorUserId: junior.userId });
    });
  });
});

describe('generateTemporaryPassword', () => {
  it('is 12 unambiguous characters, and differs every time', () => {
    const passwords = Array.from({ length: 200 }, generateTemporaryPassword);
    for (const password of passwords) {
      expect(password).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    }
    expect(new Set(passwords).size).toBe(200);
  });
});
