import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { at, cashWorld, MONDAY } from './world.js';

/**
 * Day close (M08, US-060, US-055, US-043, BR-16, BR-16a) against real rows,
 * rolled back. Closing marks slots MISSED and writes the audit log, which
 * rejects DELETE, so this tier is where it is proven.
 */
describe('DayCloseService (US-060, US-055, US-043)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const evening = at('2026-01-05', '20:00:00');

  it('Scenario: closing summarises the line — expected 4,500, collected 4,320, a shortfall of 180, every LOW, EXTRA and NO_PAYMENT listed', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      const a = await w.account('1500', 'Anbu');
      const b = await w.account('1500', 'Bala');
      const c = await w.account('1000', 'Chitra');
      const d = await w.account('500', 'Deepa');
      await w.collect(a.id, '1500');
      await w.collect(b.id, '1320');
      await w.collect(c.id, '1500');
      await w.collect(d.id, '0');
      await w.synced();

      const open = await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening);
      expect(open).toMatchObject({
        status: 'OPEN',
        day: { kind: 'WORKING' },
        expectedTotal: '4500.00',
        collectedTotal: '4320.00',
        canClose: true,
        canReopen: false,
      });

      const closed = await w.dayCloses.close(
        w.senior,
        w.line.id,
        MONDAY,
        false,
        evening,
      );
      expect(closed).toMatchObject({
        status: 'CLOSED',
        expectedTotal: '4500.00',
        collectedTotal: '4320.00',
        cashReceivedTotal: '0.00',
        discrepancy: '-4320.00',
        closedByName: expect.any(String),
        canClose: false,
      });
      // Shortfall = expected − collected = 180 (S-05 derives it).
      expect(
        closed.exceptions.map((e) => [e.kind, e.customerName]).sort(),
      ).toEqual([
        ['EXTRA', 'Chitra'],
        ['LOW', 'Bala'],
        ['NO_PAYMENT', 'Deepa'],
      ]);
      expect(closed.juniors).toEqual([
        expect.objectContaining({
          userId: w.junior.userId,
          collectedAmount: '4320.00',
          entries: 4,
          sync: 'SENT',
        }),
      ]);
      const row = await tx.dayClose.findUniqueOrThrow({
        where: {
          lineId_businessDate: {
            lineId: w.line.id,
            businessDate: new Date('2026-01-05'),
          },
        },
      });
      expect(row).toMatchObject({
        status: 'CLOSED',
        closedByUserId: w.senior.userId,
      });
      expect(row.collectedTotal.toFixed(2)).toBe('4320.00');

      await expect(
        w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening),
      ).rejects.toMatchObject({ code: 'DAY_ALREADY_CLOSED', status: 409 });
    });
  });

  it('Scenario: closing with unsynced devices warns which Juniors have not synced, and closes anyway when confirmed', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      const a = await w.account('100');
      await w.collect(a.id, '100');

      // Not heard from today.
      await expect(
        w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening),
      ).rejects.toMatchObject({ code: 'UNSYNCED_DEVICES', status: 409 });

      // Two collections still on the phone, the oldest from today.
      await w.devices.report(
        w.junior,
        {
          unsentCount: 2,
          oldestUnsentAt: at('2026-01-05', '16:00:00').toISOString(),
        },
        at('2026-01-05', '19:00:00'),
      );
      const view = await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening);
      expect(view.juniors[0]).toMatchObject({ sync: 'UNSENT', unsentCount: 2 });
      await expect(
        w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening),
      ).rejects.toMatchObject({
        code: 'UNSYNCED_DEVICES',
        details: [{ field: w.junior.userId, issue: '2 not sent' }],
      });

      await expect(
        w.dayCloses.close(w.senior, w.line.id, MONDAY, true, evening),
      ).resolves.toMatchObject({ status: 'CLOSED' });
    });
  });

  it('US-043: closing marks an unvisited slot MISSED without penalising the account — the plan runs a day longer', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      const visited = await w.account('100', 'Visited');
      const missed = await w.account('100', 'Not visited');
      await w.collect(visited.id, '100');
      await w.synced();

      const before = await tx.accountLoan.findUniqueOrThrow({
        where: { id: missed.id },
      });
      const closed = await w.dayCloses.close(
        w.senior,
        w.line.id,
        MONDAY,
        false,
        evening,
      );
      expect(closed.exceptions).toEqual([
        expect.objectContaining({
          kind: 'MISSED',
          customerName: 'Not visited',
          expectedAmount: '100.00',
          amount: null,
        }),
      ]);

      const slot = await tx.accountSchedule.findFirstOrThrow({
        where: { accountLoanId: missed.id, dueDate: new Date('2026-01-05') },
      });
      expect(slot.status).toBe('MISSED');
      const after = await tx.accountLoan.findUniqueOrThrow({
        where: { id: missed.id },
      });
      expect(after.outstandingAmount.toFixed(2)).toBe(
        before.outstandingAmount.toFixed(2),
      );
      // 20 slots from Tuesday 6 January: the target moves one working day out.
      expect(after.targetCompletionDate > before.targetCompletionDate).toBe(
        true,
      );
      expect(
        await tx.accountSchedule.count({
          where: { accountLoanId: missed.id, status: 'PENDING' },
        }),
      ).toBe(20);
    });
  });

  it('US-055 and US-043: a collection for the closed day syncing at 9pm is accepted on its date, answers the MISSED slot, and reopens the day with the new figure', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      const a = await w.account('100');
      await w.synced();
      await w.dayCloses.close(
        w.senior,
        w.line.id,
        MONDAY,
        false,
        at('2026-01-05', '18:00:00'),
      );

      const late = await w.collect(a.id, '100', '2026-01-05', '2026-01-05');
      expect(late.businessDate).toBe('2026-01-05');

      const slot = await tx.accountSchedule.findUniqueOrThrow({
        where: { id: late.accountScheduleId! },
      });
      expect(slot).toMatchObject({
        status: 'COLLECTED',
        dueDate: new Date('2026-01-05'),
      });

      const view = await w.dayCloses.view(
        w.senior,
        w.line.id,
        MONDAY,
        at('2026-01-05', '21:30:00'),
      );
      expect(view).toMatchObject({
        status: 'REOPENED',
        collectedTotal: '100.00',
        reopenReason: null,
        canClose: true,
      });
      expect(view.exceptions).toEqual([]);
      const row = await tx.dayClose.findUniqueOrThrow({
        where: {
          lineId_businessDate: {
            lineId: w.line.id,
            businessDate: new Date('2026-01-05'),
          },
        },
      });
      expect(row.collectedTotal.toFixed(2)).toBe('100.00');
      const reopened = await tx.auditLog.findFirst({
        where: {
          entityTable: 'day_close',
          entityId: row.id,
          action: 'REOPEN_DAY',
        },
      });
      expect(reopened?.after).toMatchObject({ automatic: true });
      // M10 is not built: "the Senior is notified" is not asserted.
    });
  });

  it('a manual reopen needs an Admin and a closed day; a future day cannot be closed', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await w.synced();
      await expect(
        w.dayCloses.reopen(w.admin, w.line.id, MONDAY, 'Recount', evening),
      ).rejects.toMatchObject({ code: 'DAY_NOT_CLOSED', status: 409 });

      await w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening);
      const reopened = await w.dayCloses.reopen(
        w.admin,
        w.line.id,
        MONDAY,
        'Cash recounted at the office',
        evening,
      );
      expect(reopened).toMatchObject({
        status: 'REOPENED',
        reopenReason: 'Cash recounted at the office',
      });

      await expect(
        w.dayCloses.close(
          w.senior,
          w.line.id,
          parseCalendarDate('2026-01-06'),
          true,
          evening,
        ),
      ).rejects.toMatchObject({ code: 'DAY_NOT_STARTED', status: 422 });
    });
  });

  it("a day with nothing due tallies on close, and another line's Senior cannot see it (404)", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await w.synced();
      await expect(
        w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening),
      ).resolves.toMatchObject({
        status: 'TALLIED',
        expectedTotal: '0.00',
        collectedTotal: '0.00',
      });
      await expect(
        w.dayCloses.view(w.otherSenior, w.line.id, MONDAY, evening),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      expect(
        (
          await w.dayCloses.view(
            w.senior,
            w.line.id,
            parseCalendarDate('2026-01-04'),
            evening,
          )
        ).day,
      ).toEqual({
        kind: 'SUNDAY',
      });
    });
  });
});
