import type { CollectionReport } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { addCalendarDays, parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { Database } from '../../src/platform/database/database.js';
import { CollectionReportService } from '../../src/reports/collection-report.service.js';
import { at, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { businessMonday, failingClient } from '../dashboards/business-world.js';
import { withRollback } from '../with-rollback.js';

/**
 * The collection report (M12, US-086) against real rows, rolled back — it
 * reads collections and their ledger postings, which reject DELETE. The world
 * is `dashboards/business-world.ts`: North holds Line A (₹500-a-day accounts)
 * and Line B (one at ₹100); South holds Line C (one at ₹300). Every account is
 * A = 20 × D, first slot Monday 5 January 2026.
 */
describe('CollectionReportService (US-086)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TUESDAY = '2026-01-06';
  const WEDNESDAY = '2026-01-07';
  const MONDAY_EVENING = at('2026-01-05', '20:00:00');
  const WEDNESDAY_EVENING = at(WEDNESDAY, '20:00:00');
  type Row = NonNullable<CollectionReport['lines']>[number];
  const rowOf = (report: CollectionReport, lineId: string): Row =>
    report.lines!.find((row) => row.lineId === lineId)!;

  /**
   * Monday on Line A, one of every outcome BR-08 names: ₹500 asked and ₹500
   * paid (CORRECT), ₹400 paid (LOW), ₹600 paid (EXTRA), a visit with nothing
   * paid (NO_PAYMENT), and one customer never visited — the day close marks
   * that slot MISSED (BR-09). Line B takes ₹150 against ₹100; Line C ₹300.
   */
  async function everyOutcome(tx: PrismaClient) {
    const w = await businessMonday(tx);
    const extra = await w.account(w.line.id, w.north, '500');
    const silent = await w.account(w.line.id, w.north, '500');
    const unvisited = await w.account(w.line.id, w.north, '500');
    await w.collect(w.junior, extra.id, '600');
    await w.collect(w.junior, silent.id, '0');
    await w.dayCloses.close(w.senior, w.line.id, MONDAY, true, MONDAY_EVENING);
    return { ...w, unvisited };
  }

  it('Scenario: one day, every BR-08 outcome — the breakdown beside expected against collected', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await everyOutcome(tx);
      const report = await w.collectionReport.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );

      expect(report).toMatchObject({
        from: MONDAY,
        to: MONDAY,
        generatedAt: MONDAY_EVENING.toISOString(),
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
        // Five slots at ₹500; ₹500 + ₹400 + ₹600 + ₹0 collected. BR-16 is per
        // line per day, so one customer's ₹100 surplus is not the line's extra.
        collections: {
          expected: '2500.00',
          collected: '1500.00',
          variance: '-1000.00',
          pending: '1000.00',
          extra: '0.00',
          missed: 1,
        },
        classification: {
          recorded: 4,
          amount: '1500.00',
          correct: { count: 1, amount: '500.00' },
          low: { count: 1, amount: '400.00' },
          extra: { count: 1, amount: '600.00' },
          noPayment: { count: 1, amount: '0.00' },
          adjusted: { count: 0, amount: '0.00' },
        },
      });
      expect(rowOf(report, w.otherLine.id)).toMatchObject({
        collections: {
          expected: '100.00',
          collected: '150.00',
          variance: '50.00',
          pending: '0.00',
          extra: '50.00',
          missed: 0,
        },
        classification: {
          recorded: 1,
          extra: { count: 1, amount: '150.00' },
          correct: { count: 0, amount: '0.00' },
        },
      });
      expect(rowOf(report, w.lineC.id)).toMatchObject({
        sectorName: 'South',
        classification: { correct: { count: 1, amount: '300.00' } },
      });

      expect(report.totals).toEqual({
        lines: 3,
        collections: {
          expected: '2900.00',
          collected: '1950.00',
          variance: '-950.00',
          pending: '1000.00',
          extra: '50.00',
          missed: 1,
        },
        classification: {
          recorded: 6,
          amount: '1950.00',
          correct: { count: 2, amount: '800.00' },
          low: { count: 1, amount: '400.00' },
          extra: { count: 2, amount: '750.00' },
          noPayment: { count: 1, amount: '0.00' },
          adjusted: { count: 0, amount: '0.00' },
        },
      });
      // Unfiltered, the five classes are exactly what the line collected.
      for (const row of report.lines!) {
        const entries = row.classification!;
        const classes = [
          entries.correct,
          entries.low,
          entries.extra,
          entries.noPayment,
          entries.adjusted,
        ];
        expect(
          classes
            .reduce((total, tally) => total.plus(tally.amount), toMoney('0'))
            .toFixed(2),
        ).toBe(row.collections!.collected);
      }
      // By line code.
      expect(report.lines!.map((row) => row.code)).toEqual(
        report.lines!.map((row) => row.code).sort((a, b) => a.localeCompare(b)),
      );
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('for one day, agrees with the day close (S-05) and the Admin dashboard (S-20) figure for figure', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await everyOutcome(tx);
      const report = await w.collectionReport.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );
      const close = await w.dayCloses.view(
        w.senior,
        w.line.id,
        MONDAY,
        MONDAY_EVENING,
      );
      const operations = await w.operations.view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );

      const row = rowOf(report, w.line.id);
      expect(row.collections!.expected).toBe(close.expectedTotal);
      expect(row.collections!.collected).toBe(close.collectedTotal);
      const exceptions = (kind: string) =>
        close.exceptions.filter((entry) => entry.kind === kind).length;
      expect(row.classification!.low.count).toBe(exceptions('LOW'));
      expect(row.classification!.extra.count).toBe(exceptions('EXTRA'));
      expect(row.classification!.noPayment.count).toBe(
        exceptions('NO_PAYMENT'),
      );
      expect(row.collections!.missed).toBe(exceptions('MISSED'));

      for (const line of operations.lines!) {
        const reported = rowOf(report, line.lineId);
        expect(reported.collections!.expected).toBe(line.expected);
        expect(reported.collections!.collected).toBe(line.collected);
        expect(reported.collections!.missed).toBe(line.missedCount);
        expect(reported.classification!.low.count).toBe(line.lowCount);
        expect(reported.classification!.extra.count).toBe(line.extraCount);
      }
    });
  });

  it('a range is the sum of its days, count for count and to the paisa', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await everyOutcome(tx);
      // Uneven amounts, so nothing is round: ₹333.33 due, ₹333.34 and ₹0.99 paid.
      const uneven = await w.account(w.lineC.id, w.south.id, '333.33');
      await w.collect(w.juniorC, uneven.id, '333.34');
      await w.collect(w.juniorC, uneven.id, '0.99', TUESDAY);

      // Sunday 4 January is inside the range and carries nothing.
      const from = parseCalendarDate('2026-01-04');
      const to = parseCalendarDate(WEDNESDAY);
      const range = await w.collectionReport.view(
        w.admin,
        { from, to },
        WEDNESDAY_EVENING,
      );

      const days: CollectionReport[] = [];
      for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
        days.push(
          await w.collectionReport.view(
            w.admin,
            { from: date, to: date },
            WEDNESDAY_EVENING,
          ),
        );
      }
      const sumMoney = (pick: (row: Row) => string, lineId: string) =>
        days
          .reduce(
            (total, day) => total.plus(pick(rowOf(day, lineId))),
            toMoney('0'),
          )
          .toFixed(2);
      const sumCount = (pick: (row: Row) => number, lineId: string) =>
        days.reduce((total, day) => total + pick(rowOf(day, lineId)), 0);

      for (const row of range.lines!) {
        const id = row.lineId;
        expect(row.collections).toEqual({
          expected: sumMoney((day) => day.collections!.expected, id),
          collected: sumMoney((day) => day.collections!.collected, id),
          variance: sumMoney((day) => day.collections!.variance, id),
          pending: sumMoney((day) => day.collections!.pending, id),
          extra: sumMoney((day) => day.collections!.extra, id),
          missed: sumCount((day) => day.collections!.missed, id),
        });
        expect(row.classification).toEqual({
          recorded: sumCount((day) => day.classification!.recorded, id),
          amount: sumMoney((day) => day.classification!.amount, id),
          correct: {
            count: sumCount((day) => day.classification!.correct.count, id),
            amount: sumMoney((day) => day.classification!.correct.amount, id),
          },
          low: {
            count: sumCount((day) => day.classification!.low.count, id),
            amount: sumMoney((day) => day.classification!.low.amount, id),
          },
          extra: {
            count: sumCount((day) => day.classification!.extra.count, id),
            amount: sumMoney((day) => day.classification!.extra.amount, id),
          },
          noPayment: {
            count: sumCount((day) => day.classification!.noPayment.count, id),
            amount: sumMoney((day) => day.classification!.noPayment.amount, id),
          },
          adjusted: {
            count: sumCount((day) => day.classification!.adjusted.count, id),
            amount: sumMoney((day) => day.classification!.adjusted.amount, id),
          },
        });
      }
      // Line C: ₹300 + ₹333.34 on Monday, ₹0.99 on Tuesday, against ₹300 +
      // ₹333.33 due on each of Monday, Tuesday and Wednesday.
      expect(rowOf(range, w.lineC.id).collections).toEqual({
        expected: '1899.99',
        collected: '634.33',
        variance: '-1265.66',
        pending: '1265.67',
        extra: '0.01',
        missed: 0,
      });
      expect(rowOf(range, w.lineC.id).classification).toMatchObject({
        recorded: 3,
        amount: '634.33',
        correct: { count: 1, amount: '300.00' },
        extra: { count: 1, amount: '333.34' },
        low: { count: 1, amount: '0.99' },
      });
    });
  });

  it('narrows to one collector or one of BR-08’s classes, leaving the line’s own comparison alone', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await everyOutcome(tx);
      const range = { from: MONDAY, to: MONDAY };
      const everyone = await w.collectionReport.view(
        w.admin,
        range,
        MONDAY_EVENING,
      );

      const mine = await w.collectionReport.view(
        w.admin,
        { ...range, collectedByUserId: w.junior.userId },
        MONDAY_EVENING,
      );
      // Line A's four entries are all this Junior's; Line B's Junior has none here.
      expect(rowOf(mine, w.line.id).classification).toEqual(
        rowOf(everyone, w.line.id).classification,
      );
      expect(rowOf(mine, w.otherLine.id).classification).toMatchObject({
        recorded: 0,
        amount: '0.00',
        extra: { count: 0, amount: '0.00' },
      });
      // A schedule slot belongs to a line and a day, not to a Junior.
      expect(rowOf(mine, w.otherLine.id).collections).toEqual(
        rowOf(everyone, w.otherLine.id).collections,
      );

      const low = await w.collectionReport.view(
        w.admin,
        { ...range, classification: 'LOW' },
        MONDAY_EVENING,
      );
      expect(rowOf(low, w.line.id).classification).toEqual({
        recorded: 1,
        amount: '400.00',
        correct: { count: 0, amount: '0.00' },
        low: { count: 1, amount: '400.00' },
        extra: { count: 0, amount: '0.00' },
        noPayment: { count: 0, amount: '0.00' },
        adjusted: { count: 0, amount: '0.00' },
      });
      expect(rowOf(low, w.line.id).collections).toEqual(
        rowOf(everyone, w.line.id).collections,
      );
      expect(low.totals!.classification).toMatchObject({
        recorded: 1,
        low: { count: 1, amount: '400.00' },
      });
    });
  });

  it('an approved correction moves the money and shows apart from the visits (US-044)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const [first] = await tx.collection.findMany({
        where: { lineId: w.line.id, classification: 'CORRECT' },
      });
      const database = new Database(tx);
      const corrections = new CorrectionService(
        database,
        new AuditWriter(database),
        new LedgerService(database),
        new AccountSettlement(database),
        new CollectionHistoryService(database),
        w.dayCloses,
        w.notices,
      );
      // The Junior asks, an Admin decides — never the same person (US-044).
      const requested = await corrections.request(
        w.junior,
        first!.id,
        { correctedAmount: '480', reason: 'Paid 480, typed 500' },
        WEDNESDAY_EVENING,
      );
      await corrections.decide(
        w.admin,
        requested.id,
        { decision: 'APPROVED', note: 'Checked the note' },
        WEDNESDAY_EVENING,
      );

      const report = await w.collectionReport.view(
        w.admin,
        { from: MONDAY, to: WEDNESDAY, lineId: w.line.id },
        WEDNESDAY_EVENING,
      );
      const row = rowOf(report, w.line.id);
      // ₹900 collected on Monday, less the ₹20 the correction took back out
      // on the day it was approved (the adjustment carries its own date).
      expect(row.collections!.collected).toBe('880.00');
      expect(
        toMoney(row.collections!.collected)
          .minus(row.collections!.expected)
          .toFixed(2),
      ).toBe(row.collections!.variance);
      // The visit keeps the class it was written with (BR-08); the correction
      // is not a visit, so it stands on its own.
      expect(row.classification).toEqual({
        recorded: 2,
        amount: '900.00',
        correct: { count: 1, amount: '500.00' },
        low: { count: 1, amount: '400.00' },
        extra: { count: 0, amount: '0.00' },
        noPayment: { count: 0, amount: '0.00' },
        adjusted: { count: 1, amount: '-20.00' },
      });
      // Still the whole of what the line collected.
      expect(
        toMoney(row.classification!.amount)
          .plus(row.classification!.adjusted.amount)
          .toFixed(2),
      ).toBe(row.collections!.collected);
    });
  });

  it('a Senior sees only their own line, and another line, sector or collector is 404', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await everyOutcome(tx);
      const range = { from: MONDAY, to: MONDAY };
      const admin = await w.collectionReport.view(
        w.admin,
        range,
        MONDAY_EVENING,
      );
      const own = await w.collectionReport.view(
        w.senior,
        range,
        MONDAY_EVENING,
      );

      expect(own.lines).toEqual([rowOf(admin, w.line.id)]);
      expect(own.totals).toEqual({
        lines: 1,
        collections: own.lines![0]!.collections,
        classification: own.lines![0]!.classification,
      });
      // Their own line's Junior is theirs to ask about.
      const theirs = await w.collectionReport.view(
        w.senior,
        { ...range, collectedByUserId: w.junior.userId },
        MONDAY_EVENING,
      );
      expect(theirs.lines![0]!.classification!.recorded).toBe(4);

      await expect(
        w.collectionReport.view(
          w.senior,
          { ...range, lineId: w.otherLine.id },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.collectionReport.view(
          w.senior,
          { ...range, sectorId: w.south.id },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });
      // Another line's Junior: gone, exactly as a name that never existed.
      await expect(
        w.collectionReport.view(
          w.senior,
          { ...range, collectedByUserId: w.juniorB.userId },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });

      const unassigned = await w.collectionReport.view(
        { ...w.senior, currentLineId: null },
        range,
        MONDAY_EVENING,
      );
      expect(unassigned.lines).toEqual([]);
      expect(unassigned.totals).toMatchObject({
        lines: 0,
        collections: { expected: '0.00', collected: '0.00', missed: 0 },
        classification: { recorded: 0, amount: '0.00' },
      });
    });
  });

  it('S-07: a group that cannot be read is null on every row and in the totals, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const logger = { error: vi.fn() };
      const view = (model: string, method: string) =>
        new CollectionReportService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        ).view(w.admin, { from: MONDAY, to: MONDAY }, MONDAY_EVENING);

      const noEntries = await view('collection', 'groupBy');
      expect(noEntries.lines).toHaveLength(3);
      for (const row of noEntries.lines!) {
        expect(row.classification).toBeNull();
        expect(row.collections).toBeNull();
      }
      expect(noEntries.totals).toEqual({
        lines: 3,
        collections: null,
        classification: null,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: collections',
      );

      const noSlots = await new CollectionReportService(
        new Database(withoutRawQueries(tx)),
        logger as unknown as PinoLogger,
      ).view(w.admin, { from: MONDAY, to: MONDAY }, MONDAY_EVENING);
      expect(noSlots.lines!.every((row) => row.collections === null)).toBe(
        true,
      );
      expect(noSlots.totals).toMatchObject({
        collections: null,
        classification: { recorded: 4 },
      });

      const noLines = await view('line', 'findMany');
      expect(noLines).toMatchObject({ lines: null, totals: null });
    });
  });

  it('refuses a future end, a reversed or too-long range, and another organization’s line or staff', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      await expect(
        w.collectionReport.view(
          w.admin,
          { to: '2026-01-08' },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
      await expect(
        w.collectionReport.view(
          w.admin,
          { from: '2025-10-01', to: WEDNESDAY },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });

      // No range: the month so far.
      const month = await w.collectionReport.view(
        w.admin,
        {},
        WEDNESDAY_EVENING,
      );
      expect([month.from, month.to]).toEqual(['2026-01-01', WEDNESDAY]);

      const other = await createLine(tx);
      const stranger = await createStaff(tx, other.organization.id, 'JUNIOR');
      await expect(
        w.collectionReport.view(
          w.admin,
          { lineId: other.line.id },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.collectionReport.view(
          w.admin,
          { collectedByUserId: stranger.userId },
          WEDNESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });
      expect(month.lines!.map((row) => row.lineId)).not.toContain(
        other.line.id,
      );
    });
  });

  it('lists an inactive line while it carried money in the range, or when asked for', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
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
      const range = { from: MONDAY, to: WEDNESDAY };

      const listed = await w.collectionReport.view(
        w.admin,
        range,
        WEDNESDAY_EVENING,
      );
      expect(listed.lines!.map((row) => row.lineId).sort()).toEqual(
        [w.line.id, w.otherLine.id, w.lineC.id].sort(),
      );
      expect(rowOf(listed, w.otherLine.id).isActive).toBe(false);

      const asked = await w.collectionReport.view(
        w.admin,
        { ...range, lineId: unused.id },
        WEDNESDAY_EVENING,
      );
      expect(asked.lines).toHaveLength(1);
      expect(asked.lines![0]).toMatchObject({
        isActive: false,
        // Nothing happened on it: real zeros, never nulls.
        collections: { expected: '0.00', collected: '0.00', missed: 0 },
        classification: { recorded: 0, amount: '0.00' },
      });
    });
  });
});

/**
 * A client whose raw queries reject, every Prisma model still working — so
 * only `lineRangeFigures`' slot read fails (S-07, one group at a time).
 */
function withoutRawQueries(tx: PrismaClient): PrismaClient {
  return new Proxy(tx, {
    get(target, property) {
      if (property === '$queryRaw') {
        return () => Promise.reject(new Error('connection lost'));
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
