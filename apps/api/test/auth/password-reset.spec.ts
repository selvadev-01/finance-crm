import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import {
  completePasswordReset,
  RESET_LINK_MINUTES,
  sendPasswordReset,
} from '../../src/auth/password-reset.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * US-003 self-service reset, against the real tables (Tier 1, rolled back).
 * `email_outbox` and `audit_log` are where the two halves are proven: HTTP
 * tests cannot, because audit rows reject DELETE.
 */
describe('self-service password reset (US-003)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const request = (userId: string) => ({
    userId,
    name: 'Meena',
    url: 'https://rasi.example/api/auth/reset-password/tok-123?callbackURL=%2Freset-password',
    emailEnabled: true,
  });

  describe('the email', () => {
    it('queues one PASSWORD_RESET email naming the link and how long it lasts', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'JUNIOR');

        expect(await sendPasswordReset(tx, request(staff.userId))).toBe(true);

        const email = await tx.emailOutbox.findFirstOrThrow({
          where: { userId: staff.userId },
        });
        expect(email).toMatchObject({
          organizationId: organization.id,
          kind: 'PASSWORD_RESET',
          status: 'PENDING',
          notificationId: null,
          subject: 'Set a new Rasi password',
        });
        expect(email.textBody).toContain(request(staff.userId).url);
        expect(email.textBody).toContain(`${RESET_LINK_MINUTES} minutes`);
        // Queued ready to send, so `dispatch-emails` picks it up on its next
        // pass rather than after a back-off (M10).
        expect(email.nextAttemptAt).not.toBeNull();
      });
    });

    it('queues nothing for a suspended staff member, who could not sign in anyway', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'SENIOR');
        await tx.staffProfile.update({
          where: { id: staff.id },
          data: { status: 'SUSPENDED' },
        });

        expect(await sendPasswordReset(tx, request(staff.userId))).toBe(false);
        expect(
          await tx.emailOutbox.count({ where: { userId: staff.userId } }),
        ).toBe(0);
      });
    });

    it('queues nothing for a soft-deleted staff member', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'JUNIOR');
        await tx.staffProfile.update({
          where: { id: staff.id },
          data: { deletedAt: new Date() },
        });

        expect(await sendPasswordReset(tx, request(staff.userId))).toBe(false);
        expect(
          await tx.emailOutbox.count({ where: { userId: staff.userId } }),
        ).toBe(0);
      });
    });

    it('queues nothing for a user who is not staff at all', async () => {
      await withRollback(prisma, async (tx) => {
        const stranger = randomUUID();
        expect(await sendPasswordReset(tx, request(stranger))).toBe(false);
        expect(
          await tx.emailOutbox.count({ where: { userId: stranger } }),
        ).toBe(0);
      });
    });

    it('queues nothing with EMAIL_PROVIDER=NONE, so no row waits for a server that will never send it', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'ADMIN');

        const queued = await sendPasswordReset(tx, {
          ...request(staff.userId),
          emailEnabled: false,
        });

        expect(queued).toBe(false);
        expect(
          await tx.emailOutbox.count({ where: { userId: staff.userId } }),
        ).toBe(0);
      });
    });
  });

  describe('completing the reset', () => {
    it('clears a forced password change and audits it, counting the sessions about to be revoked', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'JUNIOR');
        await tx.staffProfile.update({
          where: { id: staff.id },
          data: { mustChangePassword: true },
        });
        for (const suffix of ['phone', 'desk']) {
          await tx.session.create({
            data: {
              id: `${staff.userId}-${suffix}`,
              userId: staff.userId,
              token: `${staff.userId}-${suffix}`,
              expiresAt: new Date('2026-12-31T00:00:00.000Z'),
            },
          });
        }

        await completePasswordReset(tx, staff.userId);

        const after = await tx.staffProfile.findUniqueOrThrow({
          where: { id: staff.id },
        });
        expect(after.mustChangePassword).toBe(false);

        const entry = await tx.auditLog.findFirstOrThrow({
          where: { entityId: staff.id, action: 'UPDATE' },
        });
        expect(entry).toMatchObject({
          organizationId: organization.id,
          actorUserId: staff.userId,
          entityTable: 'staff_profile',
          before: { mustChangePassword: true },
          after: {
            mustChangePassword: false,
            passwordReset: 'SELF_SERVICE',
            sessionsRevoked: 2,
          },
        });
      });
    });

    it('audits a reset by someone who was not forced to change, without a flag to clear', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        const staff = await createStaff(tx, organization.id, 'SENIOR');

        await completePasswordReset(tx, staff.userId);

        const entry = await tx.auditLog.findFirstOrThrow({
          where: { entityId: staff.id, action: 'UPDATE' },
        });
        expect(entry.before).toMatchObject({ mustChangePassword: false });
        expect(entry.after).toMatchObject({
          passwordReset: 'SELF_SERVICE',
          sessionsRevoked: 0,
        });
      });
    });

    it('records nothing for a user with no staff profile', async () => {
      await withRollback(prisma, async (tx) => {
        const stranger = randomUUID();
        await completePasswordReset(tx, stranger);
        expect(
          await tx.auditLog.count({ where: { actorUserId: stranger } }),
        ).toBe(0);
      });
    });
  });
});
