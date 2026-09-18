import type { DiscrepancyReport, DiscrepancyRow } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { addCalendarDays, parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { Database } from '../../src/platform/database/database.js';
import { DiscrepancyReportService } from '../../src/reports/discrepancy-report.service.js';
import { at, counts, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { businessWorld, failingClient } from '../dashboards/business-world.js';
import { withRollback } from '../with-rollback.js';

/**
 * The discrepancy report (M12, BR-17) against real rows, rolled back — it
 * disburses, collects and hands cash over, all of which post to the ledger.
 *
 * The world is `dashboards/business-world.ts`: North holds Line A (`line`,
 * with its Senior) and Line B (`otherLine`, with `otherSenior`); South holds
 * Line C. Every account is A = 20 × D disbursed on Saturday 3 January 2026,
 * first slot Monday 5 January.
 */
describe('DiscrepancyReportService (M12, BR-17)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TUESDAY = '2026-01-06';
  const MONDAY_EVENING = at(MONDAY, '20:00:00');
  const TUESDAY_EVENING = at(TUESDAY, '20:00:00');

  /** ₹880: one ₹20 note and one ₹100 note short of the ₹900 recorded. */
  const eightEighty = counts({ 500: 1, 200: 1, 100: 1, 50: 1, 20: 1, 10: 1 });
  /** ₹520 against ₹500 recorded: one ₹20 note too many. */
  const fiveTwenty = counts({ 500: 1, 20: 1 });

  const rowsOf = (report: DiscrepancyReport, lineId: string) =>
    report.data.filter((row) => row.lineId === lineId);
  const rowFor = (report: DiscrepancyReport, userId: string): DiscrepancyRow =>
    report.data.find((row) => row.collectedByUserId === userId)!;

  /**
   * Monday on Line A, with the two signs a cash office actually sees. The
   * line's first Junior collects ₹900 and counts out ₹880 — ₹20 short. A
   * second Junior on the same line collects ₹500 and counts out ₹520 — ₹20
   * over. Both are acknowledged, so both have moved. Line B's Junior collects
   * ₹150 and hands over exactly that.
   */
  async function mondayOnLineA(tx: PrismaClient) {
    const w = await businessWorld(tx);
    const second = await w.addJunior(w.line.id);
    const a1 = await w.account(w.line.id, w.north, '500');
    const a2 = await w.account(w.line.id, w.north, '500');
    const a3 = await w.account(w.line.id, w.north, '500');
    const b1 = await w.account(w.otherLine.id, w.north, '100');
    await w.collect(w.junior, a1.id, '500');
    await w.collect(w.junior, a2.id, '400');
    await w.collect(second, a3.id, '500');
    await w.collect(w.juniorB, b1.id, '150');

    const hand = async (
      who: typeof w.junior,
      lineId: string,
      by: typeof eightEighty,
      note: string | undefined,
      receiver: typeof w.senior,
    ) => {
      const handover = await w.handovers.handOver(
        who,
        { lineId, businessDate: MONDAY, counts: by, note },
        MONDAY_EVENING,
      );
      await w.handovers.acknowledge(receiver, handover.id, MONDAY_EVENING);
      return handover;
    };
    await hand(
      w.junior,
      w.line.id,
      eightEighty,
      'Kept ₹20 for the auto fare',
      w.senior,
    );
    await hand(
      second,
      w.line.id,
      fiveTwenty,
      'Change from yesterday',
      w.senior,
    );
    await hand(
      w.juniorB,
      w.otherLine.id,
      counts({ 100: 1, 50: 1 }),
      undefined,
      w.otherSenior,
    );
    return { ...w, second };
  }

  it('Scenario: one line, one day, a short Junior and an over Junior — the two signs stay apart', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const report = await w.discrepancies.view(
        w.admin,
        { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
        MONDAY_EVENING,
      );

      expect(report).toMatchObject({
        from: MONDAY,
        to: MONDAY,
        generatedAt: MONDAY_EVENING.toISOString(),
        hasMore: false,
        nextCursor: null,
      });
      expect(rowFor(report, w.junior.userId)).toMatchObject({
        businessDate: MONDAY,
        lineId: w.line.id,
        lineCode: w.line.code,
        sectorId: w.north,
        collectedByUserId: w.junior.userId,
        collected: '900.00',
        dayCloseStatus: 'OPEN',
        cash: {
          handedOver: '880.00',
          acknowledged: '880.00',
          awaiting: '0.00',
          // Short: the sign points at the Junior, and is never made absolute.
          difference: '-20.00',
          state: 'SHORT',
        },
      });
      expect(rowFor(report, w.second.userId)).toMatchObject({
        collected: '500.00',
        cash: {
          handedOver: '520.00',
          acknowledged: '520.00',
          difference: '20.00',
          state: 'OVER',
        },
      });

      // The handover behind each difference, with its own stored figures.
      const short = rowFor(report, w.junior.userId).cash!.handovers;
      expect(short).toHaveLength(1);
      expect(short[0]).toMatchObject({
        status: 'ACKNOWLEDGED',
        toUserId: w.senior.userId,
        toName: expect.any(String),
        declared: '880.00',
        recorded: '900.00',
        difference: '-20.00',
        note: 'Kept ₹20 for the auto fare',
        disputeNote: null,
      });
      expect(short[0]!.acknowledgedAt).toBe(MONDAY_EVENING.toISOString());

      // ₹20 short on one Junior and ₹20 over on another is not a clean book.
      expect(report.summary).toEqual({
        rows: 3,
        lines: 2,
        days: 1,
        collected: '1550.00',
        cash: {
          handedOver: '1550.00',
          acknowledged: '1550.00',
          awaiting: '0.00',
          short: '20.00',
          over: '20.00',
          net: '0.00',
          unresolved: 2,
        },
      });
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('a day that tallies exactly is 0.00, never null, and is left out of “unresolved”', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const everything = await w.discrepancies.view(
        w.admin,
        { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
        MONDAY_EVENING,
      );
      const tallied = rowFor(everything, w.juniorB.userId);
      expect(tallied).toMatchObject({
        lineId: w.otherLine.id,
        collected: '150.00',
        cash: {
          handedOver: '150.00',
          acknowledged: '150.00',
          awaiting: '0.00',
          // Real zero: this Junior's cash is accounted for to the paisa.
          difference: '0.00',
          state: 'TALLIED',
          handovers: [expect.objectContaining({ difference: '0.00' })],
        },
      });

      const unresolved = await w.discrepancies.view(
        w.admin,
        { from: MONDAY, to: MONDAY, limit: 50, show: 'unresolved' },
        MONDAY_EVENING,
      );
      expect(
        unresolved.data.map((row) => row.collectedByUserId).sort(),
      ).toEqual([w.junior.userId, w.second.userId].sort());
      expect(unresolved.summary).toMatchObject({
        rows: 2,
        collected: '1400.00',
        cash: { short: '20.00', over: '20.00', net: '0.00', unresolved: 2 },
      });
    });
  });

  it('cash still on its way is AWAITING, not short — counted, then acknowledged', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await w.account(w.line.id, w.north, '500');
      await w.collect(w.junior, account.id, '500');
      const ask = () =>
        w.discrepancies.view(
          w.admin,
          { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
          MONDAY_EVENING,
        );

      // Nothing handed over yet: ₹500 still in the Junior's hand.
      const beforeCount = rowFor(await ask(), w.junior.userId);
      expect(beforeCount.cash).toMatchObject({
        handedOver: '0.00',
        difference: '-500.00',
        state: 'AWAITING',
        handovers: [],
      });

      const handover = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: counts({ 500: 1 }) },
        MONDAY_EVENING,
      );
      const pending = rowFor(await ask(), w.junior.userId);
      expect(pending.cash).toMatchObject({
        handedOver: '500.00',
        acknowledged: '0.00',
        awaiting: '500.00',
        difference: '0.00',
        state: 'AWAITING',
      });

      await w.handovers.acknowledge(w.senior, handover.id, MONDAY_EVENING);
      const settled = rowFor(await ask(), w.junior.userId);
      expect(settled.cash).toMatchObject({
        acknowledged: '500.00',
        awaiting: '0.00',
        difference: '0.00',
        state: 'TALLIED',
      });

      // A disputed count moved no cash and is in no amount (US-063).
      const recount = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 100: 1 }),
          note: 'Found another ₹100',
        },
        MONDAY_EVENING,
      );
      await w.handovers.dispute(w.senior, recount.id, 'Counted ₹0, not ₹100');
      const disputed = rowFor(await ask(), w.junior.userId);
      expect(disputed.cash).toMatchObject({
        acknowledged: '500.00',
        handedOver: '500.00',
        difference: '0.00',
        state: 'DISPUTED',
      });
      expect(disputed.cash!.handovers).toHaveLength(2);
    });
  });

  it('an approved correction closes the difference on the day it lands (US-044, BR-14)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await w.account(w.line.id, w.north, '500');
      const recorded = await w.collect(w.junior, account.id, '500');
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 200: 2 }),
          note: 'Counted ₹400',
        },
        MONDAY_EVENING,
      );
      await w.handovers.acknowledge(w.senior, handover.id, MONDAY_EVENING);

      const ask = () =>
        w.discrepancies.view(
          w.admin,
          { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
          MONDAY_EVENING,
        );
      expect(rowFor(await ask(), w.junior.userId).cash).toMatchObject({
        difference: '-100.00',
        state: 'SHORT',
      });

      // The Junior asks, an Admin decides — never the same person (US-044).
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
      const requested = await corrections.request(
        w.junior,
        recorded.collection.id,
        { correctedAmount: '400', reason: 'Took ₹400, typed ₹500' },
        MONDAY_EVENING,
      );
      await corrections.decide(
        w.admin,
        requested.id,
        { decision: 'APPROVED', note: 'Checked the note' },
        MONDAY_EVENING,
      );

      // The ADJUSTMENT carries the original's line and collector on the day it
      // was approved, so the Junior's day now reads ₹400 collected, ₹400 out.
      const resolved = rowFor(await ask(), w.junior.userId);
      expect(resolved.collected).toBe('400.00');
      expect(resolved.cash).toMatchObject({
        handedOver: '400.00',
        acknowledged: '400.00',
        difference: '0.00',
        state: 'TALLIED',
      });
      const unresolved = await w.discrepancies.view(
        w.admin,
        { from: MONDAY, to: MONDAY, limit: 50, show: 'unresolved' },
        MONDAY_EVENING,
      );
      expect(unresolved.data).toEqual([]);
      expect(unresolved.summary).toMatchObject({
        rows: 0,
        collected: '0.00',
        cash: { short: '0.00', over: '0.00', net: '0.00', unresolved: 0 },
      });
    });
  });

  it('a range is exactly the sum of its days, to the paisa', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      // Tuesday: ₹333.33 recorded against ₹334 counted out — no note is worth
      // 33 paise, so the count can only ever be a whole number of rupees.
      const uneven = await w.account(w.line.id, w.north, '333.33');
      await w.collect(w.junior, uneven.id, '333.33', TUESDAY);
      const tuesday = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: parseCalendarDate(TUESDAY),
          counts: counts({ 200: 1, 100: 1, 20: 1, 10: 1, 2: 2 }),
          note: 'Rounded up; no coin for the paise',
        },
        TUESDAY_EVENING,
      );
      await w.handovers.acknowledge(w.senior, tuesday.id, TUESDAY_EVENING);

      // Sunday 4 January is inside the range and carries nothing at all.
      const from = parseCalendarDate('2026-01-04');
      const to = parseCalendarDate(TUESDAY);
      const ask = (first: string, last: string) =>
        w.discrepancies.view(
          w.admin,
          { from: first, to: last, limit: 200, show: 'all' },
          TUESDAY_EVENING,
        );
      const range = await ask(from, to);

      const days: DiscrepancyReport[] = [];
      for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
        days.push(await ask(date, date));
      }
      const sumMoney = (pick: (day: DiscrepancyReport) => string) =>
        days
          .reduce((total, day) => total.plus(pick(day)), toMoney('0'))
          .toFixed(2);
      const sumCount = (pick: (day: DiscrepancyReport) => number) =>
        days.reduce((total, day) => total + pick(day), 0);

      expect(range.summary.collected).toBe(
        sumMoney((day) => day.summary.collected),
      );
      expect(range.summary.rows).toBe(sumCount((day) => day.summary.rows));
      expect(range.summary.cash).toEqual({
        handedOver: sumMoney((day) => day.summary.cash!.handedOver),
        acknowledged: sumMoney((day) => day.summary.cash!.acknowledged),
        awaiting: sumMoney((day) => day.summary.cash!.awaiting),
        short: sumMoney((day) => day.summary.cash!.short),
        over: sumMoney((day) => day.summary.cash!.over),
        net: sumMoney((day) => day.summary.cash!.net),
        unresolved: sumCount((day) => day.summary.cash!.unresolved),
      });
      // Tuesday's ₹0.67 surplus does not cancel Monday's ₹20 shortfall.
      expect(range.summary.cash).toMatchObject({
        short: '20.00',
        over: '20.67',
        net: '0.67',
      });
      expect(rowsOf(range, w.line.id)).toHaveLength(3);
    });
  });

  it('agrees with the day close (S-05) for the line’s day, figure for figure', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const report = await w.discrepancies.view(
        w.admin,
        { from: MONDAY, to: MONDAY, lineId: w.line.id, limit: 50, show: 'all' },
        MONDAY_EVENING,
      );
      const close = await w.dayCloses.view(
        w.senior,
        w.line.id,
        MONDAY,
        MONDAY_EVENING,
      );

      const rows = rowsOf(report, w.line.id);
      const total = (pick: (row: DiscrepancyRow) => string) =>
        rows.reduce((sum, row) => sum.plus(pick(row)), toMoney('0')).toFixed(2);
      expect(total((row) => row.collected)).toBe(close.collectedTotal);
      expect(total((row) => row.cash!.acknowledged)).toBe(
        close.cashReceivedTotal,
      );
      // The day close's own discrepancy is cash received less collected — the
      // Juniors' rows summed, which is the only definition either screen uses.
      expect(
        toMoney(total((row) => row.cash!.acknowledged))
          .minus(total((row) => row.collected))
          .toFixed(2),
      ).toBe(close.discrepancy);
      // The same handovers, one row each.
      expect(rows.flatMap((row) => row.cash!.handovers)).toHaveLength(
        close.handovers.length,
      );
    });
  });

  it('a Senior sees only their own line; another line, sector or Junior is 404', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const range = { from: MONDAY, to: MONDAY, limit: 50 } as const;
      const admin = await w.discrepancies.view(
        w.admin,
        { ...range, show: 'all' },
        MONDAY_EVENING,
      );
      const own = await w.discrepancies.view(
        w.senior,
        { ...range, show: 'all' },
        MONDAY_EVENING,
      );

      expect(own.data).toEqual(rowsOf(admin, w.line.id));
      expect(own.summary).toMatchObject({ rows: 2, lines: 1, days: 1 });
      // Their own line's Junior is theirs to ask about.
      const theirs = await w.discrepancies.view(
        w.senior,
        { ...range, show: 'all', collectedByUserId: w.junior.userId },
        MONDAY_EVENING,
      );
      expect(theirs.data).toHaveLength(1);
      expect(theirs.data[0]!.cash!.difference).toBe('-20.00');

      for (const [query, code] of [
        [{ lineId: w.otherLine.id }, 'LINE_NOT_FOUND'],
        [{ sectorId: w.south.id }, 'SECTOR_NOT_FOUND'],
        [{ collectedByUserId: w.juniorB.userId }, 'STAFF_NOT_FOUND'],
      ] as const) {
        await expect(
          w.discrepancies.view(
            w.senior,
            { ...range, show: 'all', ...query },
            MONDAY_EVENING,
          ),
        ).rejects.toMatchObject({ code, status: 404 });
      }

      const unassigned = await w.discrepancies.view(
        { ...w.senior, currentLineId: null },
        { ...range, show: 'all' },
        MONDAY_EVENING,
      );
      expect(unassigned.data).toEqual([]);
      expect(unassigned.summary).toEqual({
        rows: 0,
        lines: 0,
        days: 0,
        collected: '0.00',
        cash: {
          handedOver: '0.00',
          acknowledged: '0.00',
          awaiting: '0.00',
          short: '0.00',
          over: '0.00',
          net: '0.00',
          unresolved: 0,
        },
      });
    });
  });

  it('S-07: a group that cannot be read is null on every row and in the summary, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const logger = { error: vi.fn() };
      const view = (model: string, method: string) =>
        new DiscrepancyReportService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        ).view(
          w.admin,
          { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
          MONDAY_EVENING,
        );

      const noCash = await view('cashHandover', 'findMany');
      expect(noCash.data).toHaveLength(3);
      for (const row of noCash.data) {
        expect(row.cash).toBeNull();
        // The collections are still known: only the cash side is unreadable.
        expect(row.collected).not.toBe('0.00');
      }
      expect(noCash.summary).toMatchObject({
        rows: 3,
        collected: '1550.00',
        cash: null,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: handovers',
      );

      const noStatus = await view('dayClose', 'findMany');
      expect(noStatus.data).toHaveLength(3);
      for (const row of noStatus.data) {
        expect(row.dayCloseStatus).toBeNull();
        expect(row.cash).not.toBeNull();
      }
    });
  });

  it('pages through the cursor, newest day first, and refuses a cursor it did not issue', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const account = await w.account(w.line.id, w.north, '500');
      await w.collect(w.junior, account.id, '500', TUESDAY);
      const range = {
        from: MONDAY,
        to: parseCalendarDate(TUESDAY),
        show: 'all',
      } as const;

      const all = await w.discrepancies.view(
        w.admin,
        { ...range, limit: 50 },
        TUESDAY_EVENING,
      );
      expect(all.data.map((row) => row.businessDate)).toEqual([
        TUESDAY,
        MONDAY,
        MONDAY,
        MONDAY,
      ]);
      expect(all.hasMore).toBe(false);

      const first = await w.discrepancies.view(
        w.admin,
        { ...range, limit: 2 },
        TUESDAY_EVENING,
      );
      expect(first.data).toEqual(all.data.slice(0, 2));
      expect(first.hasMore).toBe(true);
      const second = await w.discrepancies.view(
        w.admin,
        { ...range, limit: 2, cursor: first.nextCursor! },
        TUESDAY_EVENING,
      );
      expect(second.data).toEqual(all.data.slice(2));
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeNull();
      // The summary is the whole matching set, so paging never moves a total.
      expect(second.summary).toEqual(all.summary);

      await expect(
        w.discrepancies.view(
          w.admin,
          { ...range, limit: 2, cursor: 'nonsense' },
          TUESDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 });
    });
  });

  it('takes the range rule every report takes, and no other organization’s rows', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await mondayOnLineA(tx);
      const ask = (query: Record<string, unknown>) =>
        w.discrepancies.view(
          w.admin,
          { limit: 50, show: 'all', ...query },
          TUESDAY_EVENING,
        );

      await expect(ask({ to: '2026-01-08' })).rejects.toMatchObject({
        code: 'DATE_IN_FUTURE',
        status: 422,
      });
      await expect(
        ask({ from: '2025-10-01', to: TUESDAY }),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });
      await expect(ask({ from: TUESDAY, to: MONDAY })).rejects.toMatchObject({
        code: 'INVALID_DATE_RANGE',
        status: 400,
      });

      // No range: the month so far.
      const month = await ask({});
      expect([month.from, month.to]).toEqual(['2026-01-01', TUESDAY]);

      const other = await createLine(tx);
      const stranger = await createStaff(tx, other.organization.id, 'JUNIOR');
      await expect(ask({ lineId: other.line.id })).rejects.toMatchObject({
        code: 'LINE_NOT_FOUND',
        status: 404,
      });
      await expect(
        ask({ collectedByUserId: stranger.userId }),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND', status: 404 });
      expect(month.data.map((row) => row.lineId)).not.toContain(other.line.id);
    });
  });
});
