import type { PrismaClient, StaffRole } from '@repo/db';
import { toBusinessDate } from '@repo/domain';
import { randomInt, randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { PasswordHasher } from '../../src/identity/password-hasher.js';
import { StaffAdminService } from '../../src/identity/staff-admin.service.js';
import { StaffDirectoryService } from '../../src/identity/staff-directory.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { testRecorder } from '../security/recorder.js';
import { withRollback } from '../with-rollback.js';

/**
 * Staff administration (US-092) against real rows, rolled back — so the audit
 * entries, credential, sessions and assignment rows can be inspected. The
 * safety rules are the point of this file: no escalation, nothing done to
 * yourself, and no silent loss of an assignment or of unsynced collections.
 */
describe('StaffAdminService (US-092)', () => {
  let prisma: PrismaClient;
  const hasher = new PasswordHasher();
  const today = toBusinessDate(new Date());

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    name: 'Meena Collector',
    email: `new-${randomUUID()}@staff-admin.rasi.test`,
    phone: `+919${randomInt(100_000_000, 999_999_999)}`,
    role: 'JUNIOR' as StaffRole,
    ...overrides,
  });

  async function world(tx: PrismaClient, actorRole: StaffRole = 'ADMIN') {
    const { organization, line } = await createLine(tx);
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
    const service = new StaffAdminService(
      database,
      new AuditWriter(database),
      hasher,
      new StaffDirectoryService(database),
      testRecorder(tx),
    );

    /** Someone to act on, with two signed-in devices. */
    const target = async (role: StaffRole = 'JUNIOR') => {
      const staff = await createStaff(tx, organization.id, 'JUNIOR');
      await tx.staffProfile.update({ where: { id: staff.id }, data: { role } });
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

    const assign = (
      staffProfileId: string,
      assignmentRole: 'SENIOR' | 'JUNIOR',
    ) =>
      tx.lineAssignment.create({
        data: {
          staffProfileId,
          lineId: line.id,
          assignmentRole,
          effectiveFrom: new Date('2026-01-01'),
        },
      });

    const unsynced = (staffProfileId: string, unsentCount: number) =>
      tx.deviceSyncReport.create({
        data: {
          staffProfileId,
          unsentCount,
          oldestUnsentAt: new Date('2026-09-17T04:00:00Z'),
          reportedAt: new Date('2026-09-18T04:00:00Z'),
        },
      });

    return { context, service, target, assign, unsynced, organization, line };
  }

  describe('soft delete (US-092)', () => {
    it('keeps the record and its history, signs them out, and hides them from the directory', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        // `target()` leaves them signed in on two devices.
        const junior = await target();

        const result = await service.softDelete(context, junior.id, today);

        expect(result).toMatchObject({
          staffProfileId: junior.id,
          sessionsRevoked: 2,
        });
        // The row stays: collections and audit entries name this person.
        const row = await tx.staffProfile.findUniqueOrThrow({
          where: { id: junior.id },
        });
        expect(row.deletedAt).not.toBeNull();
        expect(
          await tx.session.count({ where: { userId: junior.userId } }),
        ).toBe(0);
        // Gone from every lookup: a second delete cannot find them.
        await expect(
          service.softDelete(context, junior.id, today),
        ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: junior.id, action: 'DELETE' },
          }),
        ).not.toBeNull();
      });
    });

    it('is blocked while they hold an open line assignment — no acknowledgement escape', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, assign } = await world(tx);
        const junior = await target();
        await assign(junior.id, 'JUNIOR');

        await expect(
          service.softDelete(context, junior.id, today),
        ).rejects.toMatchObject({ code: 'STAFF_ON_DUTY' });
        expect(
          (
            await tx.staffProfile.findUniqueOrThrow({
              where: { id: junior.id },
            })
          ).deletedAt,
        ).toBeNull();
      });
    });

    it('is blocked while cash they handed over is still unacknowledged', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, line } = await world(tx);
        const junior = await target();
        const receiver = await target();
        const day = await tx.dayClose.create({
          data: {
            lineId: line.id,
            businessDate: new Date('2026-01-05'),
            expectedTotal: '500.00',
            collectedTotal: '500.00',
            cashReceivedTotal: '0.00',
            discrepancy: '-500.00',
            // A closed day carries when it was closed (constraint).
            closedAt: new Date('2026-01-05T18:00:00Z'),
            status: 'CLOSED',
          },
        });
        await tx.cashHandover.create({
          data: {
            dayCloseId: day.id,
            hop: 'JUNIOR_TO_SENIOR',
            fromUserId: junior.userId,
            toUserId: receiver.userId,
            declaredAmount: '500.00',
            systemAmount: '500.00',
            discrepancy: '0.00',
            status: 'PENDING',
            // The database checks the counts add up to what was declared.
            denominations: {
              create: [{ denomination: 500, count: 1, subtotal: '500.00' }],
            },
          },
        });

        await expect(
          service.softDelete(context, junior.id, today),
        ).rejects.toMatchObject({ code: 'STAFF_HAS_UNACKNOWLEDGED_CASH' });
      });
    });

    it('refuses deleting yourself', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        await expect(
          service.softDelete(context, context.staffProfileId, today),
        ).rejects.toMatchObject({ code: 'CANNOT_DELETE_SELF' });
      });
    });
  });

  describe('creating a staff member', () => {
    it('writes the user, its credential and the profile, with a temporary password that signs in once', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);
        const body = input();

        const result = await service.create(context, body, today);

        expect(result.staff).toMatchObject({
          name: body.name,
          email: body.email,
          phone: body.phone,
          role: 'JUNIOR',
          status: 'ACTIVE',
          joinedAt: today,
          currentAssignment: null,
        });
        expect(result.staff.staffCode).toMatch(/^JR-[0-9A-F]{8}$/);
        expect(result.temporaryPassword).toMatch(
          /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/,
        );

        const profile = await tx.staffProfile.findUniqueOrThrow({
          where: { id: result.staff.staffProfileId },
        });
        // The existing forced-change flow, not a second one (US-003).
        expect(profile.mustChangePassword).toBe(true);
        expect(profile.createdByUserId).toBe(context.userId);

        const credential = await tx.account.findFirstOrThrow({
          where: { userId: profile.userId, providerId: 'credential' },
        });
        expect(
          await hasher.verify(credential.password!, result.temporaryPassword),
        ).toBe(true);
      });
    });

    it('audits the creation inside the transaction, without the temporary password', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        const result = await service.create(context, input(), today);

        const row = await tx.auditLog.findFirstOrThrow({
          where: {
            entityTable: 'staff_profile',
            entityId: result.staff.staffProfileId,
          },
        });
        expect(row).toMatchObject({
          action: 'CREATE',
          actorUserId: context.userId,
          organizationId: context.organizationId,
        });
        expect(JSON.stringify(row)).not.toContain(result.temporaryPassword);
      });
    });

    it('refuses to create a role above the creator’s own (403), which is how an Admin would promote themselves', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx, 'ADMIN');

        await expect(
          service.create(context, input({ role: 'SUPER_ADMIN' }), today),
        ).rejects.toMatchObject({ code: 'ROLE_ABOVE_OWN', status: 403 });

        // An equal role is allowed: the matrix lets an Admin create an Admin.
        await expect(
          service.create(context, input({ role: 'ADMIN' }), today),
        ).resolves.toMatchObject({ staff: { role: 'ADMIN' } });
      });
    });

    it('refuses an email or mobile number already in use (409), naming the field', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);
        const first = await service.create(context, input(), today);

        await expect(
          service.create(context, input({ email: first.staff.email }), today),
        ).rejects.toMatchObject({
          code: 'EMAIL_TAKEN',
          status: 409,
          details: [{ field: 'email' }],
        });
        await expect(
          service.create(context, input({ phone: first.staff.phone }), today),
        ).rejects.toMatchObject({
          code: 'PHONE_TAKEN',
          status: 409,
          details: [{ field: 'phone' }],
        });
      });
    });

    it('refuses a joining date in the future (422), because an assignment cannot start before it', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        await expect(
          service.create(context, input({ joinedAt: '2099-01-01' }), today),
        ).rejects.toMatchObject({
          code: 'JOINED_IN_FUTURE',
          status: 422,
          details: [{ field: 'joinedAt' }],
        });
      });
    });
  });

  describe('changing a role', () => {
    it('records the change with its before and after, and takes effect on the profile', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx, 'SUPER_ADMIN');
        const junior = await target('JUNIOR');

        const detail = await service.changeRole(
          context,
          junior.id,
          'SENIOR',
          today,
        );

        expect(detail.role).toBe('SENIOR');
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: junior.id, action: 'UPDATE' },
          }),
        ).toMatchObject({
          before: { role: 'JUNIOR' },
          after: { role: 'SENIOR' },
        });
      });
    });

    it('refuses changing your own role (422), so the last Super Admin cannot demote themselves', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx, 'SUPER_ADMIN');

        await expect(
          service.changeRole(context, context.staffProfileId, 'JUNIOR', today),
        ).rejects.toMatchObject({
          code: 'CANNOT_CHANGE_OWN_ROLE',
          status: 422,
        });
        expect(
          (
            await tx.staffProfile.findUniqueOrThrow({
              where: { id: context.staffProfileId },
            })
          ).role,
        ).toBe('SUPER_ADMIN');
      });
    });

    it('refuses while a line assignment the new role could not hold is open (422), naming the line', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, assign, line } = await world(
          tx,
          'SUPER_ADMIN',
        );
        const senior = await target('SENIOR');
        await assign(senior.id, 'SENIOR');

        await expect(
          service.changeRole(context, senior.id, 'JUNIOR', today),
        ).rejects.toMatchObject({
          code: 'STAFF_HAS_OPEN_ASSIGNMENT',
          status: 422,
        });
        await expect(
          service.changeRole(context, senior.id, 'ADMIN', today),
        ).rejects.toMatchObject({ code: 'STAFF_HAS_OPEN_ASSIGNMENT' });

        // Closed yesterday, so nothing is left to contradict.
        await tx.lineAssignment.updateMany({
          where: { staffProfileId: senior.id, lineId: line.id },
          data: { effectiveTo: new Date('2026-01-31') },
        });
        await expect(
          service.changeRole(context, senior.id, 'ADMIN', today),
        ).resolves.toMatchObject({ role: 'ADMIN' });
      });
    });

    it('refuses the role they already have (422)', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx, 'SUPER_ADMIN');
        const junior = await target('JUNIOR');

        await expect(
          service.changeRole(context, junior.id, 'JUNIOR', today),
        ).rejects.toMatchObject({ code: 'ROLE_UNCHANGED', status: 422 });
      });
    });
  });

  describe('suspending and reactivating', () => {
    it('revokes every session and audits the change, in one transaction', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        const junior = await target();

        const result = await service.changeStatus(
          context,
          junior.id,
          { status: 'SUSPENDED', acknowledgeOnDuty: false },
          today,
        );

        expect(result.sessionsRevoked).toBe(2);
        expect(result.staff.status).toBe('SUSPENDED');
        expect(
          await tx.session.count({ where: { userId: junior.userId } }),
        ).toBe(0);
        expect(
          await tx.auditLog.findFirst({ where: { entityId: junior.id } }),
        ).toMatchObject({
          action: 'UPDATE',
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED', sessionsRevoked: 2 },
        });
      });
    });

    it('reactivating restores the status and revokes nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        const junior = await target();
        await tx.staffProfile.update({
          where: { id: junior.id },
          data: { status: 'SUSPENDED' },
        });

        const result = await service.changeStatus(
          context,
          junior.id,
          { status: 'ACTIVE', acknowledgeOnDuty: false },
          today,
        );

        expect(result.staff.status).toBe('ACTIVE');
        expect(result.sessionsRevoked).toBe(0);
        expect(result.openAssignment).toBeNull();
      });
    });

    it('refuses while a line assignment is open, until the Admin acknowledges it (422 then 200)', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, assign, line } = await world(tx);
        const junior = await target();
        await assign(junior.id, 'JUNIOR');

        await expect(
          service.changeStatus(
            context,
            junior.id,
            { status: 'SUSPENDED', acknowledgeOnDuty: false },
            today,
          ),
        ).rejects.toMatchObject({
          code: 'STAFF_ON_DUTY',
          status: 422,
          details: [{ field: 'acknowledgeOnDuty' }],
        });
        expect(
          (
            await tx.staffProfile.findUniqueOrThrow({
              where: { id: junior.id },
            })
          ).status,
        ).toBe('ACTIVE');

        const result = await service.changeStatus(
          context,
          junior.id,
          { status: 'SUSPENDED', acknowledgeOnDuty: true },
          today,
        );

        // The assignment is reported, never rewritten: closing it today would
        // change a date collections are already attributed by (M03, BR-15).
        expect(result.openAssignment).toMatchObject({ lineId: line.id });
        expect(
          await tx.lineAssignment.findFirstOrThrow({
            where: { staffProfileId: junior.id },
          }),
        ).toMatchObject({ effectiveTo: null });
        expect(
          await tx.auditLog.findFirst({ where: { entityId: junior.id } }),
        ).toMatchObject({ after: { openAssignmentLeft: line.id } });
      });
    });

    it('refuses while collections are still on their phone, and reports them once acknowledged', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, unsynced } = await world(tx);
        const junior = await target();
        await unsynced(junior.id, 3);

        await expect(
          service.changeStatus(
            context,
            junior.id,
            { status: 'INACTIVE', acknowledgeOnDuty: false },
            today,
          ),
        ).rejects.toMatchObject({
          code: 'STAFF_ON_DUTY',
          details: [
            { issue: expect.stringContaining('3 collections are still') },
          ],
        });

        const result = await service.changeStatus(
          context,
          junior.id,
          { status: 'INACTIVE', acknowledgeOnDuty: true },
          today,
        );
        expect(result.unsyncedWork).toMatchObject({ unsentCount: 3 });
        expect(
          await tx.auditLog.findFirst({ where: { entityId: junior.id } }),
        ).toMatchObject({ after: { unsyncedAtChange: 3 } });
      });
    });

    it('refuses changing your own status (422), so nobody signs themselves out of their own access', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        await expect(
          service.changeStatus(
            context,
            context.staffProfileId,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).rejects.toMatchObject({
          code: 'CANNOT_CHANGE_OWN_STATUS',
          status: 422,
        });
      });
    });

    it('an Admin cannot suspend a Super Admin (403); a Super Admin can', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx, 'ADMIN');
        const owner = await target('SUPER_ADMIN');

        await expect(
          service.changeStatus(
            context,
            owner.id,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).rejects.toMatchObject({
          code: 'CANNOT_MANAGE_HIGHER_ROLE',
          status: 403,
        });

        const asOwner: RequestContext = { ...context, role: 'SUPER_ADMIN' };
        await expect(
          service.changeStatus(
            asOwner,
            owner.id,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).resolves.toMatchObject({ staff: { status: 'SUSPENDED' } });
      });
    });

    it('refuses the status they already have (422)', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        const junior = await target();

        await expect(
          service.changeStatus(
            context,
            junior.id,
            { status: 'ACTIVE', acknowledgeOnDuty: false },
            today,
          ),
        ).rejects.toMatchObject({ code: 'STATUS_UNCHANGED', status: 422 });
      });
    });
  });

  describe('correcting details', () => {
    it('updates the name and mobile number and audits both sides of the change', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        const junior = await target();
        const phone = `+919${randomInt(100_000_000, 999_999_999)}`;

        const detail = await service.update(
          context,
          junior.id,
          { name: 'Corrected Name', phone },
          today,
        );

        expect(detail).toMatchObject({ name: 'Corrected Name', phone });
        expect(
          await tx.auditLog.findFirst({ where: { entityId: junior.id } }),
        ).toMatchObject({ after: { name: 'Corrected Name', phone } });
      });
    });

    it('refuses a mobile number another staff member already has (409)', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx);
        const [one, two] = [await target(), await target()];
        const taken = await tx.staffProfile.findUniqueOrThrow({
          where: { id: two.id },
        });

        await expect(
          service.update(
            context,
            one.id,
            { name: 'Any Name', phone: taken.phone },
            today,
          ),
        ).rejects.toMatchObject({ code: 'PHONE_TAKEN', status: 409 });
      });
    });

    it('an Admin cannot edit a Super Admin (403)', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target } = await world(tx, 'ADMIN');
        const owner = await target('SUPER_ADMIN');

        await expect(
          service.update(
            context,
            owner.id,
            { name: 'Renamed', phone: `+919${randomInt(1e8, 9e8 - 1)}` },
            today,
          ),
        ).rejects.toMatchObject({
          code: 'CANNOT_MANAGE_HIGHER_ROLE',
          status: 403,
        });
      });
    });
  });

  /**
   * The security log (ADR-0014) — the four guards above leave a durable record of the attempt, not
   * only a log line. Each assertion is the one an investigator needs: who,
   * against whom, and which rule said no.
   */
  describe('the refused attempt is recorded (M13, ADR-0014)', () => {
    const events = (tx: PrismaClient, organizationId: string) =>
      tx.securityEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });

    it('records an Admin reaching for the Super Admin role, and stores none of the person they invented', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organization } = await world(tx, 'ADMIN');
        const body = input({ role: 'SUPER_ADMIN' });

        await expect(
          service.create(context, body, today),
        ).rejects.toMatchObject({ code: 'ROLE_ABOVE_OWN' });

        const [row, ...rest] = await events(tx, organization.id);
        expect(rest).toEqual([]);
        expect(row).toMatchObject({
          actorUserId: context.userId,
          actorRole: 'ADMIN',
          kind: 'RANK_GUARD',
          code: 'ROLE_ABOVE_OWN',
          status: 403,
          detail: { attemptedRole: 'SUPER_ADMIN' },
        });
        // The role is the whole fact. The name, email and mobile number the
        // attempt carried are not stored anywhere (M13, SAFE_LOG_KEYS).
        const written = JSON.stringify(row);
        expect(written).not.toContain(body.email);
        expect(written).not.toContain(body.phone);
        expect(written).not.toContain(body.name);
      });
    });

    it('records an Admin trying to suspend the owner, naming the person and their role', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, target, organization } = await world(
          tx,
          'ADMIN',
        );
        const owner = await target('SUPER_ADMIN');

        await expect(
          service.changeStatus(
            context,
            owner.id,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).rejects.toMatchObject({ code: 'CANNOT_MANAGE_HIGHER_ROLE' });

        expect(await events(tx, organization.id)).toMatchObject([
          {
            kind: 'RANK_GUARD',
            code: 'CANNOT_MANAGE_HIGHER_ROLE',
            targetTable: 'staff_profile',
            targetId: owner.id,
            detail: { targetRole: 'SUPER_ADMIN' },
          },
        ]);
      });
    });

    it('records the two self guards with what was being attempted', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organization } = await world(
          tx,
          'SUPER_ADMIN',
        );

        await expect(
          service.changeRole(context, context.staffProfileId, 'JUNIOR', today),
        ).rejects.toMatchObject({ code: 'CANNOT_CHANGE_OWN_ROLE' });
        await expect(
          service.changeStatus(
            context,
            context.staffProfileId,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).rejects.toMatchObject({ code: 'CANNOT_CHANGE_OWN_STATUS' });

        expect(await events(tx, organization.id)).toMatchObject([
          {
            kind: 'SELF_GUARD',
            code: 'CANNOT_CHANGE_OWN_ROLE',
            targetId: context.staffProfileId,
            detail: { attemptedRole: 'JUNIOR' },
          },
          {
            kind: 'SELF_GUARD',
            code: 'CANNOT_CHANGE_OWN_STATUS',
            detail: { attemptedStatus: 'SUSPENDED' },
          },
        ]);
      });
    });

    it('records an id from another organization, which is how someone finds out who else exists', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organization } = await world(tx);
        const elsewhere = await createLine(tx);
        const theirs = await createStaff(
          tx,
          elsewhere.organization.id,
          'JUNIOR',
        );

        await expect(
          service.update(
            context,
            theirs.id,
            { name: 'Renamed', phone: '+919000000001' },
            today,
          ),
        ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });

        expect(await events(tx, organization.id)).toMatchObject([
          {
            kind: 'OUT_OF_SCOPE',
            code: 'STAFF_NOT_FOUND',
            status: 404,
            targetTable: 'staff_profile',
            targetId: theirs.id,
          },
        ]);
      });
    });

    it('records nothing for an ordinary mistake — a taken email is not an attempt', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organization } = await world(tx);
        const first = await service.create(context, input(), today);

        await expect(
          service.create(context, input({ email: first.staff.email }), today),
        ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });

        expect(await events(tx, organization.id)).toEqual([]);
      });
    });
  });

  it('answers 404 for staff in another organization or soft-deleted, identical to a missing id', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, target } = await world(tx);
      const elsewhere = await createLine(tx);
      const theirs = await createStaff(tx, elsewhere.organization.id, 'JUNIOR');
      const deleted = await target();
      await tx.staffProfile.update({
        where: { id: deleted.id },
        data: { deletedAt: new Date() },
      });

      for (const id of [theirs.id, deleted.id, 'does-not-exist']) {
        await expect(
          service.changeStatus(
            context,
            id,
            { status: 'SUSPENDED', acknowledgeOnDuty: true },
            today,
          ),
        ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });
      }
    });
  });
});
