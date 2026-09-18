import type { LineWiseReport } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { addCalendarDays, parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { lineDayFigures } from '../../src/cash/line-day-figures.js';
import { Database } from '../../src/platform/database/database.js';
import { LineWiseReportService } from '../../src/reports/line-wise-report.service.js';
import { at, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine } from '../db-constraints/fixtures.js';
import {
  businessMonday,
  businessWorld,
  failingClient,
} from '../dashboards/business-world.js';
import { withRollback } from '../with-rollback.js';

/**
 * The line-wise report (M12, US-084, PDF §14) against real rows, rolled back —
 * it reads collections and ledger postings, which reject DELETE. The world is
 * `dashboards/business-world.ts`: North holds Line A (two accounts at ₹500 a
 * day, its Senior and a Junior) and Line B (one at ₹100, another Senior, a
 * Junior); South holds Line C (one at ₹300, a Junior, no Senior). Every
 * account is A = 20 × D, I = 17 × D, first slot Monday 5 January 2026.
 */
describe('LineWiseReportService (US-084)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TUESDAY = '2026-01-06';
  const WEDNESDAY = '2026-01-07';
  const WEDNESDAY_EVENING = at(WEDNESDAY, '20:00:00');
  type Row = NonNullable<LineWiseReport['lines']>[number];
  const rowOf = (report: LineWiseReport, lineId: string): Row =>
    report.lines!.find((row) => row.lineId === lineId)!;

  /**
   * Monday to Wednesday. Line A (₹1,000 due a day): ₹900 on Monday (₹100
   * short), ₹1,100 on Tuesday (₹100 over), nothing on Wednesday. Line B
   * (₹100 a day): ₹150, ₹100, ₹100. Line C (₹300 a day): ₹300 on Monday only.
   */
  async function businessWeek(tx: PrismaClient) {
    const w = await businessMonday(tx);
    const [a1, a2] = await tx.accountLoan.findMany({
      where: { customer: { lineId: w.line.id } },
      orderBy: { accountCode: 'asc' },
    });
    const [b1] = await tx.accountLoan.findMany({
      where: { customer: { lineId: w.otherLine.id } },
    });
    await w.collect(w.junior, a1!.id, '600', TUESDAY);
    await w.collect(w.junior, a2!.id, '500', TUESDAY);
    await w.collect(w.juniorB, b1!.id, '100', TUESDAY);
    await w.collect(w.juniorB, b1!.id, '100', WEDNESDAY);
    return w;
  }

  it('Scenario: Monday to Wednesday — each line’s §14 figures, with a day’s surplus never hiding another day’s shortfall', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWeek(tx);
      const report = await w.lineWise.view(
        w.admin,
        { from: MONDAY, to: WEDNESDAY },
        WEDNESDAY_EVENING,
      );

      expect(report).toMatchObject({
        from: MONDAY,
        to: WEDNESDAY,
        generatedAt: WEDNESDAY_EVENING.toISOString(),
      });
      expect(report.lines).toHaveLength(3);
      expect(rowOf(report, w.line.id)).toEqual({
        lineId: w.line.id,
        code: w.line.code,
        name: 'Line',
        isActive: true,
        sectorId: w.north,
        sectorCode: expect.any(String),
        sectorName: 'Sector',
        staff: {
          seniorName: 'Constraint Probe',
          juniorNames: ['Constraint Probe'],
        },
        book: {
          customers: 2,
          accounts: 2,
          activeAccounts: 2,
          completedAccounts: 0,
        },
        // BR-18: A = 10,000 × 2, I = 8,500 × 2.
        amounts: {
          accountAmount: '20000.00',
          invested: '17000.00',
          profit: '3000.00',
        },
        // Net ₹1,000 short, but ₹1,100 was pending on its days and ₹100 extra on Tuesday.
        collections: {
          expected: '3000.00',
          collected: '2000.00',
          pending: '1100.00',
          extra: '100.00',
        },
      });
      expect(rowOf(report, w.otherLine.id)).toMatchObject({
        staff: {
          seniorName: 'Constraint Probe',
          juniorNames: ['Constraint Probe'],
        },
        book: { customers: 1, accounts: 1, activeAccounts: 1 },
        amounts: {
          accountAmount: '2000.00',
          invested: '1700.00',
          profit: '300.00',
        },
        collections: {
          expected: '300.00',
          collected: '350.00',
          pending: '0.00',
          extra: '50.00',
        },
      });
      expect(rowOf(report, w.lineC.id)).toMatchObject({
        sectorId: w.south.id,
        sectorName: 'South',
        staff: { seniorName: null, juniorNames: ['Constraint Probe'] },
        amounts: {
          accountAmount: '6000.00',
          invested: '5100.00',
          profit: '900.00',
        },
        collections: {
          expected: '900.00',
          collected: '300.00',
          pending: '600.00',
          extra: '0.00',
        },
      });
      expect(report.totals).toEqual({
        lines: 3,
        book: {
          customers: 4,
          accounts: 4,
          activeAccounts: 4,
          completedAccounts: 0,
        },
        amounts: {
          accountAmount: '28000.00',
          invested: '23800.00',
          profit: '4200.00',
        },
        collections: {
          expected: '4200.00',
          collected: '2650.00',
          pending: '1700.00',
          extra: '150.00',
        },
      });
      // By line code.
      expect(report.lines!.map((row) => row.code)).toEqual(
        report.lines!.map((row) => row.code).sort((a, b) => a.localeCompare(b)),
      );
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('a range is the sum of its days to the paisa, BR-16 taken per line per day', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWeek(tx);
      // Uneven amounts, so nothing is round: ₹333.33 due, ₹333.34 and ₹0.99 paid.
      const uneven = await w.account(w.lineC.id, w.south.id, '333.33');
      await w.collect(w.juniorC, uneven.id, '333.34');
      await w.collect(w.juniorC, uneven.id, '0.99', TUESDAY);

      // Sunday 4 January is inside the range and carries nothing.
      const from = parseCalendarDate('2026-01-04');
      const to = parseCalendarDate(WEDNESDAY);
      const report = await w.lineWise.view(
        w.admin,
        { from, to },
        WEDNESDAY_EVENING,
      );

      const ids = [w.line.id, w.otherLine.id, w.lineC.id];
      const summed = new Map(
        ids.map((id) => [
          id,
          {
            expected: toMoney('0'),
            collected: toMoney('0'),
            pending: toMoney('0'),
            extra: toMoney('0'),
          },
        ]),
      );
      for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
        const day = await lineDayFigures(tx, ids, date);
        for (const [id, money] of day) {
          const sum = summed.get(id)!;
          const gap = money.expected.minus(money.collected);
          sum.expected = sum.expected.plus(money.expected);
          sum.collected = sum.collected.plus(money.collected);
          if (gap.greaterThan(0)) sum.pending = sum.pending.plus(gap);
          if (gap.lessThan(0)) sum.extra = sum.extra.minus(gap);
        }
      }
      for (const id of ids) {
        const sum = summed.get(id)!;
        expect(rowOf(report, id).collections).toEqual({
          expected: sum.expected.toFixed(2),
          collected: sum.collected.toFixed(2),
          pending: sum.pending.toFixed(2),
          extra: sum.extra.toFixed(2),
        });
      }
      // Line C: ₹900 + ₹999.99 due; ₹300 + ₹333.34 + ₹0.99 paid.
      expect(rowOf(report, w.lineC.id).collections).toEqual({
        expected: '1899.99',
        collected: '634.33',
        pending: '1265.67',
        extra: '0.01',
      });
      expect(report.totals!.collections).toEqual({
        expected: '5199.99',
        collected: '2984.33',
        pending: '2365.67',
        extra: '150.01',
      });
      expect(report.totals!.amounts).toEqual({
        accountAmount: '34666.60',
        invested: '29466.61',
        profit: '5199.99',
      });
    });
  });

  it('for one day, equals the Admin dashboard (US-082), the overview (US-080) and the sector comparison (US-081)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const evening = at('2026-01-05', '20:00:00');
      const report = await w.lineWise.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        evening,
      );
      const operations = await w.operations.view(w.admin, MONDAY, evening);
      const overview = await w.overview.view(w.admin, MONDAY, evening);
      const sectors = await w.sectors.view(w.admin, MONDAY, evening);

      expect(report.lines!.map((row) => row.lineId).sort()).toEqual(
        operations.lines!.map((line) => line.lineId).sort(),
      );
      for (const line of operations.lines!) {
        const row = rowOf(report, line.lineId);
        const gap = toMoney(line.expected).minus(line.collected);
        expect(row.collections).toEqual({
          expected: line.expected,
          collected: line.collected,
          pending: (gap.greaterThan(0) ? gap : toMoney('0')).toFixed(2),
          extra: (gap.lessThan(0) ? gap.negated() : toMoney('0')).toFixed(2),
        });
        expect(row.staff.juniorNames).toHaveLength(line.juniorCount);
        expect(row.staff.seniorName).toBe(line.seniorName);
        expect(row.book!.activeAccounts).toBe(line.activeAccounts);
      }
      expect(report.totals!.collections).toEqual({
        expected: overview.today!.expected,
        collected: overview.today!.collected,
        pending: overview.today!.pending,
        extra: overview.today!.extra,
      });
      expect(report.totals!.amounts).toEqual(overview.totals);
      expect(report.totals!.book).toEqual({
        customers: overview.structure!.customers,
        accounts: operations.accounts!.total,
        activeAccounts: overview.accounts!.active,
        completedAccounts: overview.accounts!.completed,
      });

      // Each sector's amounts are its lines' amounts.
      for (const sector of sectors.sectors!) {
        const lines = report.lines!.filter(
          (row) => row.sectorId === sector.sectorId,
        );
        const sum = (pick: (row: Row) => string) =>
          lines
            .reduce((total, row) => total.plus(pick(row)), toMoney('0'))
            .toFixed(2);
        expect({
          accountAmount: sum((row) => row.amounts!.accountAmount),
          invested: sum((row) => row.amounts!.invested),
          profit: sum((row) => row.amounts!.profit),
        }).toEqual(sector.totals);
        expect(
          lines.reduce((total, row) => total + row.book!.customers, 0),
        ).toBe(sector.structure!.customers);
      }
    });
  });

  it('a Senior sees only their own line — with its invested and profit — and another line or sector is 404', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWeek(tx);
      const range = { from: MONDAY, to: WEDNESDAY };
      const admin = await w.lineWise.view(w.admin, range, WEDNESDAY_EVENING);
      const own = await w.lineWise.view(w.senior, range, WEDNESDAY_EVENING);

      expect(own.lines).toEqual([rowOf(admin, w.line.id)]);
      // "Invested amount" and "Profit" are own-line cells for a Senior.
      expect(own.lines![0]!.amounts).toEqual({
        accountAmount: '20000.00',
        invested: '17000.00',
        profit: '3000.00',
      });
      expect(own.totals).toEqual({
        lines: 1,
        book: own.lines![0]!.book,
        amounts: own.lines![0]!.amounts,
        collections: own.lines![0]!.collections,
      });

      // Their own sector narrows nothing further; "every line" is their line.
      const northOnly = await w.lineWise.view(
        w.senior,
        { ...range, sectorId: w.north },
        WEDNESDAY_EVENING,
      );
      expect(northOnly.lines!.map((row) => row.lineId)).toEqual([w.line.id]);

      await expect(
        w.lineWise.view(
          w.senior,
          { ...range, lineId: w.otherLine.id },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.lineWise.view(
          w.senior,
          { ...range, sectorId: w.south.id },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });

      // A Senior with no line today sees no lines, not everyone's.
      const unassigned = await w.lineWise.view(
        { ...w.senior, currentLineId: null },
        range,
        WEDNESDAY_EVENING,
      );
      expect(unassigned.lines).toEqual([]);
      expect(unassigned.totals).toMatchObject({
        lines: 0,
        amounts: { accountAmount: '0.00' },
        collections: { collected: '0.00' },
      });
    });
  });

  it('a transferred customer takes their accounts and slots to the new line; past collections stay where they were recorded (BR-15)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const moving = await w.account(w.otherLine.id, w.north, '100');
      await w.collect(w.juniorB, moving.id, '150');
      await tx.customer.update({
        where: { id: moving.customerId },
        data: { lineId: w.lineC.id, sectorId: w.south.id },
      });

      const report = await w.lineWise.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        at('2026-01-05', '20:00:00'),
      );
      expect(rowOf(report, w.otherLine.id)).toMatchObject({
        book: { customers: 0, accounts: 0 },
        amounts: { accountAmount: '0.00' },
        // Expected follows the slot to the current line, as the day close does.
        collections: {
          expected: '0.00',
          collected: '150.00',
          pending: '0.00',
          extra: '150.00',
        },
      });
      expect(rowOf(report, w.lineC.id)).toMatchObject({
        book: { customers: 1, accounts: 1 },
        amounts: {
          accountAmount: '2000.00',
          invested: '1700.00',
          profit: '300.00',
        },
        collections: {
          expected: '100.00',
          collected: '0.00',
          pending: '100.00',
          extra: '0.00',
        },
      });
    });
  });

  it('filters by sector and line; an inactive line is listed while it carried money in the range, or when asked for', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const range = { from: MONDAY, to: WEDNESDAY };
      const north = await w.lineWise.view(
        w.admin,
        { ...range, sectorId: w.north },
        WEDNESDAY_EVENING,
      );
      expect(north.lines!.map((row) => row.lineId).sort()).toEqual(
        [w.line.id, w.otherLine.id].sort(),
      );
      const one = await w.lineWise.view(
        w.admin,
        { ...range, lineId: w.lineC.id },
        WEDNESDAY_EVENING,
      );
      expect(one.lines!.map((row) => row.lineId)).toEqual([w.lineC.id]);
      expect(one.totals!.collections).toEqual(one.lines![0]!.collections);
      // A line that is not in the sector asked for: nothing, not an error.
      const neither = await w.lineWise.view(
        w.admin,
        { ...range, sectorId: w.north, lineId: w.lineC.id },
        WEDNESDAY_EVENING,
      );
      expect(neither.lines).toEqual([]);

      // Line B is closed after Monday's collection; an unused line is closed too.
      await tx.line.update({
        where: { id: w.otherLine.id },
        data: { isActive: false },
      });
      const unused = await tx.line.create({
        data: {
          organizationId: w.organizationId,
          sectorId: w.north,
          code: `L-${randomUUID()}`,
          name: 'Unused',
          isActive: false,
        },
      });
      const listed = await w.lineWise.view(w.admin, range, WEDNESDAY_EVENING);
      expect(listed.lines!.map((row) => row.lineId).sort()).toEqual(
        [w.line.id, w.otherLine.id, w.lineC.id].sort(),
      );
      expect(rowOf(listed, w.otherLine.id).isActive).toBe(false);

      // Before Monday, Line B carried nothing, so it is not listed.
      const before = await w.lineWise.view(
        w.admin,
        {
          from: parseCalendarDate('2026-01-01'),
          to: parseCalendarDate('2026-01-03'),
        },
        WEDNESDAY_EVENING,
      );
      expect(before.lines!.map((row) => row.lineId).sort()).toEqual(
        [w.line.id, w.lineC.id].sort(),
      );
      const asked = await w.lineWise.view(
        w.admin,
        { ...range, lineId: unused.id },
        WEDNESDAY_EVENING,
      );
      expect(asked.lines).toHaveLength(1);
      expect(asked.lines![0]).toMatchObject({
        isActive: false,
        collections: { expected: '0.00', collected: '0.00' },
      });
    });
  });

  it('S-07: a group that cannot be read is null on every row and in the totals, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const logger = { error: vi.fn() };
      const view = (model: string, method: string) =>
        new LineWiseReportService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        ).view(w.admin, { from: MONDAY, to: MONDAY }, WEDNESDAY_EVENING);

      const noCollections = await view('collection', 'groupBy');
      expect(noCollections.lines).toHaveLength(3);
      for (const row of noCollections.lines!) {
        expect(row.collections).toBeNull();
        expect(row.amounts).not.toBeNull();
        expect(row.book).not.toBeNull();
      }
      expect(noCollections.totals).toMatchObject({
        lines: 3,
        collections: null,
        amounts: { accountAmount: '28000.00' },
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: collections',
      );

      const noAmounts = await view('ledgerEntry', 'findMany');
      expect(noAmounts.lines!.every((row) => row.amounts === null)).toBe(true);
      expect(noAmounts.totals).toMatchObject({
        amounts: null,
        collections: { collected: '1350.00' },
      });

      const noCustomers = await view('customer', 'groupBy');
      expect(noCustomers.lines!.every((row) => row.book === null)).toBe(true);
      expect(noCustomers.totals!.book).toBeNull();

      const noLines = await view('line', 'findMany');
      expect(noLines).toMatchObject({ lines: null, totals: null });
    });
  });

  it('refuses a future end, a reversed or too-long range, and another organization’s line', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      await expect(
        w.lineWise.view(w.admin, { to: '2026-01-08' }, WEDNESDAY_EVENING),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
      await expect(
        w.lineWise.view(
          w.admin,
          { from: '2025-10-01', to: WEDNESDAY },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });

      // No range: the month so far.
      const month = await w.lineWise.view(w.admin, {}, WEDNESDAY_EVENING);
      expect([month.from, month.to]).toEqual(['2026-01-01', WEDNESDAY]);

      const other = await createLine(tx);
      await expect(
        w.lineWise.view(w.admin, { lineId: other.line.id }, WEDNESDAY_EVENING),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.lineWise.view(
          w.admin,
          { sectorId: other.sector.id },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });
      expect(month.lines!.map((row) => row.lineId)).not.toContain(
        other.line.id,
      );
    });
  });
});
