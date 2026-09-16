import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AssignmentService } from '../../src/organisation/assignment.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import {
  createActiveAccount,
  createStaff,
  decimal,
} from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';
import { testNotifications } from '../notifications/notices.js';

/**
 * Staff assignment (M03, US-012, US-013) against real rows, rolled back — so
 * real `audit_log` rows can be asserted too.
 */
describe('AssignmentService (US-012, US-013)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** An organization with an ACTIVE account on Line 3, Line 7 and Line 5, and an Admin. */
  async function world(tx: PrismaClient) {
    const three = await createActiveAccount(tx);
    const organizationId = three.organization.id;
    const line = (name: string) =>
      tx.line.create({
        data: {
          organizationId,
          sectorId: three.sector.id,
          code: `L-${randomUUID()}`,
          name,
        },
      });
    const seven = await line('Line 7');
    const five = await line('Line 5');
    const admin = await createStaff(tx, organizationId, 'SENIOR');
    const context: RequestContext = {
      requestId: 'req_test',
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId,
      role: 'ADMIN',
      currentLineId: null,
    };
    const database = new Database(tx);
    const service = new AssignmentService(
      database,
      new AuditWriter(database),
      testNotifications(database).notices,
    );
    const open = (
      staffProfileId: string,
      lineId: string,
      role: 'SENIOR' | 'JUNIOR',
      from: string,
    ) =>
      tx.lineAssignment.create({
        data: {
          staffProfileId,
          lineId,
          assignmentRole: role,
          effectiveFrom: new Date(from),
        },
      });
    return { three, seven, five, context, service, open, organizationId };
  }

  describe('Scenario: assigning replaces the incumbent (US-012)', () => {
    it("closes Priya's assignment the day before Rajan's opens, and deletes nothing", async () => {
      await withRollback(prisma, async (tx) => {
        const { three, context, service, open, organizationId } =
          await world(tx);
        const priya = await createStaff(tx, organizationId, 'SENIOR');
        const rajan = await createStaff(tx, organizationId, 'SENIOR');
        const priyaOnThree = await open(
          priya.id,
          three.line.id,
          'SENIOR',
          '2026-01-01',
        );

        const result = await service.assignSenior(context, three.line.id, {
          staffProfileId: rajan.id,
          effectiveFrom: '2026-09-13',
        });

        expect(result.closed).toEqual([
          expect.objectContaining({
            id: priyaOnThree.id,
            effectiveTo: '2026-09-12',
          }),
        ]);
        expect(result.assignment).toMatchObject({
          lineId: three.line.id,
          staffProfileId: rajan.id,
          assignmentRole: 'SENIOR',
          effectiveFrom: '2026-09-13',
          effectiveTo: null,
        });
        expect(result.linesWithoutSenior).toEqual([]);
        expect(
          await tx.lineAssignment.count({ where: { lineId: three.line.id } }),
        ).toBe(2);
      });
    });

    it('writes an UPDATE for the closed row and a CREATE for the new one, by the Admin, in the same transaction', async () => {
      await withRollback(prisma, async (tx) => {
        const { three, context, service, open, organizationId } =
          await world(tx);
        const priya = await createStaff(tx, organizationId, 'SENIOR');
        const rajan = await createStaff(tx, organizationId, 'SENIOR');
        const priyaOnThree = await open(
          priya.id,
          three.line.id,
          'SENIOR',
          '2026-01-01',
        );

        const { assignment } = await service.assignSenior(
          context,
          three.line.id,
          {
            staffProfileId: rajan.id,
            effectiveFrom: '2026-09-13',
          },
        );

        const rows = await tx.auditLog.findMany({
          where: { entityId: { in: [priyaOnThree.id, assignment.id] } },
          orderBy: { createdAt: 'asc' },
        });
        expect(rows).toEqual([
          expect.objectContaining({
            action: 'UPDATE',
            entityTable: 'line_assignment',
            entityId: priyaOnThree.id,
            actorUserId: context.userId,
            before: { effectiveTo: null },
            after: { effectiveTo: '2026-09-12' },
          }),
          expect.objectContaining({
            action: 'CREATE',
            entityTable: 'line_assignment',
            entityId: assignment.id,
            actorUserId: context.userId,
          }),
        ]);
      });
    });

    it('assigns the first Senior of a line with nothing to close', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, organizationId } = await world(tx);
        const senior = await createStaff(tx, organizationId, 'SENIOR');
        const result = await service.assignSenior(context, seven.id, {
          staffProfileId: senior.id,
          effectiveFrom: '2026-09-13',
        });
        expect(result.closed).toEqual([]);
      });
    });
  });

  describe('Scenario: mid-term reassignment preserves history (US-013, BR-15)', () => {
    it('moving Suresh to Line 7 effective tomorrow closes Line 3 today, and his 400 collections stay on Line 3', async () => {
      await withRollback(prisma, async (tx) => {
        const { three, seven, context, service, open, organizationId } =
          await world(tx);
        const suresh = await createStaff(tx, organizationId, 'JUNIOR');
        const onThree = await open(
          suresh.id,
          three.line.id,
          'JUNIOR',
          '2026-01-01',
        );

        await tx.collection.createMany({
          data: Array.from({ length: 400 }, (_, day) => ({
            idempotencyKey: randomUUID(),
            accountLoanId: three.account.id,
            lineId: three.line.id,
            collectedByUserId: suresh.userId,
            businessDate: new Date(Date.UTC(2026, 0, 2 + day)),
            capturedAt: new Date(Date.UTC(2026, 0, 2 + day, 5)),
            syncedAt: new Date(Date.UTC(2026, 0, 2 + day, 5)),
            expectedAmount: decimal('100.00'),
            amount: decimal('100.00'),
            variance: decimal('0.00'),
            classification: 'CORRECT' as const,
          })),
        });
        const lineThreeTotals = () =>
          tx.collection.aggregate({
            where: { lineId: three.line.id },
            _count: true,
            _sum: { amount: true },
          });
        const before = await lineThreeTotals();

        const result = await service.assignJunior(context, seven.id, {
          staffProfileId: suresh.id,
          effectiveFrom: '2026-09-14',
        });

        expect(result.closed).toEqual([
          expect.objectContaining({
            id: onThree.id,
            effectiveTo: '2026-09-13',
          }),
        ]);
        const after = await lineThreeTotals();
        expect(after._count).toBe(400);
        expect(after._sum.amount?.toString()).toBe(
          before._sum.amount?.toString(),
        );
        expect(after._sum.amount?.toString()).toBe('40000');
        expect(
          await tx.collection.count({
            where: {
              collectedByUserId: suresh.userId,
              lineId: { not: three.line.id },
            },
          }),
        ).toBe(0);
      });
    });

    it('assigns a Junior who is not on any line yet, and tells them (M10 NEW_ASSIGNMENT)', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, organizationId } = await world(tx);
        const junior = await createStaff(tx, organizationId, 'JUNIOR');
        const result = await service.assignJunior(context, seven.id, {
          staffProfileId: junior.id,
          effectiveFrom: '2026-09-13',
        });
        expect(result).toMatchObject({ closed: [], linesWithoutSenior: [] });
        const told = await tx.notification.findMany({ where: { userId: junior.userId } });
        expect(told).toEqual([
          expect.objectContaining({ eventType: 'NEW_ASSIGNMENT', category: 'INFORMATION' }),
        ]);
        expect(told[0]!.body).toContain('is a Junior on');
        expect(await tx.notification.count({ where: { userId: context.userId } })).toBe(0);
      });
    });
  });

  describe('a Senior who already runs another line (decided 2026-09-13: allowed, reported)', () => {
    it('moving Rajan from Line 5 to Line 3 reports Line 5 as left without a Senior', async () => {
      await withRollback(prisma, async (tx) => {
        const { three, five, context, service, open, organizationId } =
          await world(tx);
        const rajan = await createStaff(tx, organizationId, 'SENIOR');
        await open(rajan.id, five.id, 'SENIOR', '2026-01-01');

        const result = await service.assignSenior(context, three.line.id, {
          staffProfileId: rajan.id,
          effectiveFrom: '2026-09-13',
        });

        expect(result.linesWithoutSenior).toEqual([five.id]);
        expect(
          await tx.lineAssignment.count({
            where: {
              lineId: five.id,
              assignmentRole: 'SENIOR',
              effectiveTo: null,
            },
          }),
        ).toBe(0);
      });
    });

    it('two Seniors can be swapped with two ordinary assignments', async () => {
      await withRollback(prisma, async (tx) => {
        const { three, five, context, service, open, organizationId } =
          await world(tx);
        const priya = await createStaff(tx, organizationId, 'SENIOR');
        const rajan = await createStaff(tx, organizationId, 'SENIOR');
        await open(priya.id, three.line.id, 'SENIOR', '2026-01-01');
        await open(rajan.id, five.id, 'SENIOR', '2026-01-01');

        await service.assignSenior(context, three.line.id, {
          staffProfileId: rajan.id,
          effectiveFrom: '2026-09-13',
        });
        const second = await service.assignSenior(context, five.id, {
          staffProfileId: priya.id,
          effectiveFrom: '2026-09-13',
        });

        expect(second.linesWithoutSenior).toEqual([]);
        const current = await tx.lineAssignment.findMany({
          where: {
            lineId: { in: [three.line.id, five.id] },
            effectiveTo: null,
          },
          select: { lineId: true, staffProfileId: true },
        });
        expect(current).toEqual(
          expect.arrayContaining([
            { lineId: three.line.id, staffProfileId: rajan.id },
            { lineId: five.id, staffProfileId: priya.id },
          ]),
        );
        expect(current).toHaveLength(2);
      });
    });
  });

  describe('refusals', () => {
    it.each([
      [
        'a Junior into the Senior assignment',
        'JUNIOR',
        'SENIOR',
        {},
        'STAFF_ROLE_MISMATCH',
      ],
      [
        'a Senior into a Junior assignment',
        'SENIOR',
        'JUNIOR',
        {},
        'STAFF_ROLE_MISMATCH',
      ],
      [
        'a suspended staff member',
        'SENIOR',
        'SENIOR',
        { status: 'SUSPENDED' as const },
        'STAFF_NOT_ACTIVE',
      ],
    ] as const)(
      'refuses %s',
      async (_label, staffRole, assignmentRole, change, code) => {
        await withRollback(prisma, async (tx) => {
          const { seven, context, service, organizationId } = await world(tx);
          const staff = await createStaff(tx, organizationId, staffRole);
          await tx.staffProfile.update({
            where: { id: staff.id },
            data: change,
          });
          const assign =
            assignmentRole === 'SENIOR'
              ? service.assignSenior
              : service.assignJunior;

          await expect(
            assign.call(service, context, seven.id, {
              staffProfileId: staff.id,
              effectiveFrom: '2026-09-13',
            }),
          ).rejects.toMatchObject({ code });
        });
      },
    );

    it('refuses an assignment starting before the staff member joined', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, organizationId } = await world(tx);
        const senior = await createStaff(tx, organizationId, 'SENIOR'); // joined 2026-01-01
        await expect(
          service.assignSenior(context, seven.id, {
            staffProfileId: senior.id,
            effectiveFrom: '2025-12-31',
          }),
        ).rejects.toMatchObject({
          code: 'EFFECTIVE_BEFORE_JOINING',
          status: 422,
        });
      });
    });

    it('refuses an assignment that does not start after the one it replaces, and changes nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { three, context, service, open, organizationId } =
          await world(tx);
        const priya = await createStaff(tx, organizationId, 'SENIOR');
        const rajan = await createStaff(tx, organizationId, 'SENIOR');
        await open(priya.id, three.line.id, 'SENIOR', '2026-09-13');

        await expect(
          service.assignSenior(context, three.line.id, {
            staffProfileId: rajan.id,
            effectiveFrom: '2026-09-13',
          }),
        ).rejects.toMatchObject({ code: 'EFFECTIVE_NOT_AFTER_CURRENT' });
        expect(
          await tx.lineAssignment.count({
            where: { lineId: three.line.id, effectiveTo: null },
          }),
        ).toBe(1);
      });
    });

    it('refuses to assign someone to the line they are already on (409)', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, open, organizationId } =
          await world(tx);
        const junior = await createStaff(tx, organizationId, 'JUNIOR');
        await open(junior.id, seven.id, 'JUNIOR', '2026-01-01');
        await expect(
          service.assignJunior(context, seven.id, {
            staffProfileId: junior.id,
            effectiveFrom: '2026-09-13',
          }),
        ).rejects.toMatchObject({ code: 'ALREADY_ASSIGNED', status: 409 });
      });
    });

    it('refuses an inactive line', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, organizationId } = await world(tx);
        await tx.line.update({
          where: { id: seven.id },
          data: { isActive: false },
        });
        const junior = await createStaff(tx, organizationId, 'JUNIOR');
        await expect(
          service.assignJunior(context, seven.id, {
            staffProfileId: junior.id,
            effectiveFrom: '2026-09-13',
          }),
        ).rejects.toMatchObject({ code: 'LINE_INACTIVE' });
      });
    });

    it('answers 404 for a line or a staff member in another organization', async () => {
      await withRollback(prisma, async (tx) => {
        const { seven, context, service, organizationId } = await world(tx);
        const elsewhere = await createActiveAccount(tx);
        const theirJunior = await createStaff(
          tx,
          elsewhere.organization.id,
          'JUNIOR',
        );
        const ourJunior = await createStaff(tx, organizationId, 'JUNIOR');

        await expect(
          service.assignJunior(context, elsewhere.line.id, {
            staffProfileId: ourJunior.id,
            effectiveFrom: '2026-09-13',
          }),
        ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
        await expect(
          service.assignJunior(context, seven.id, {
            staffProfileId: theirJunior.id,
            effectiveFrom: '2026-09-13',
          }),
        ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });
      });
    });
  });
});
