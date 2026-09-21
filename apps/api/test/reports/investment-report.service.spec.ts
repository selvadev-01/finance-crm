import type { InvestmentReport } from '@repo/contracts';
import { openLinePeriod } from '../database.js';
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
import { InvestmentReportService } from '../../src/reports/investment-report.service.js';
import { at, MONDAY, SATURDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine } from '../db-constraints/fixtures.js';
import {
  businessMonday,
  businessWorld,
  failingClient,
} from '../dashboards/business-world.js';
import { withRollback } from '../with-rollback.js';

/**
 * The investment overview (M12, US-085, PDF §22) against real rows, rolled
 * back — it reads disbursements, collections and their ledger postings, which
 * reject DELETE. The world is `dashboards/business-world.ts`: North holds
 * Line A (two accounts at ₹500 a day) and Line B (one at ₹100); South holds
 * Line C (one at ₹300). Every account is A = 20 × D, I = 17 × D, P = 3 × D,
 * disbursed Saturday 3 January 2026 with its first slot Monday 5.
 */
describe('InvestmentReportService (US-085)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TUESDAY = '2026-01-06';
  const WEDNESDAY = '2026-01-07';
  const THURSDAY = '2026-01-08';
  const THURSDAY_EVENING = at(THURSDAY, '20:00:00');
  const MONDAY_EVENING = at('2026-01-05', '20:00:00');
  type Row = NonNullable<InvestmentReport['lines']>[number];
  const rowOf = (report: InvestmentReport, lineId: string): Row =>
    report.lines!.find((row) => row.lineId === lineId)!;

  it('Scenario: §22 per line and overall — what was contracted, and what the ledger actually holds', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const report = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );

      expect(report).toMatchObject({
        from: MONDAY,
        to: MONDAY,
        generatedAt: MONDAY_EVENING.toISOString(),
      });
      // Line A: two ₹500-a-day accounts, ₹500 and ₹400 collected on Monday.
      // BR-18 on the running total, per account: 15% of ₹500 and of ₹400.
      expect(rowOf(report, w.line.id)).toEqual({
        lineId: w.line.id,
        code: w.line.code,
        name: 'Line',
        isActive: true,
        sectorId: w.north,
        sectorCode: expect.any(String),
        sectorName: 'Sector',
        position: {
          accounts: 2,
          accountAmount: '20000.00',
          invested: '17000.00',
          profit: '3000.00',
          outstanding: '19100.00',
          returned: '900.00',
          profitEarned: '135.00',
          profitToEarn: '2865.00',
        },
        // Monday alone: the disbursements were Saturday, so only money came back.
        range: {
          disbursements: 0,
          accountAmount: '0.00',
          invested: '0.00',
          profit: '0.00',
          returned: '900.00',
          profitEarned: '135.00',
        },
      });
      expect(rowOf(report, w.otherLine.id).position).toEqual({
        accounts: 1,
        accountAmount: '2000.00',
        invested: '1700.00',
        profit: '300.00',
        outstanding: '1850.00',
        returned: '150.00',
        profitEarned: '22.50',
        profitToEarn: '277.50',
      });
      expect(rowOf(report, w.lineC.id).position).toEqual({
        accounts: 1,
        accountAmount: '6000.00',
        invested: '5100.00',
        profit: '900.00',
        outstanding: '5700.00',
        returned: '300.00',
        profitEarned: '45.00',
        profitToEarn: '855.00',
      });
      expect(report.totals).toEqual({
        lines: 3,
        position: {
          accounts: 4,
          accountAmount: '28000.00',
          invested: '23800.00',
          profit: '4200.00',
          outstanding: '26650.00',
          returned: '1350.00',
          profitEarned: '202.50',
          profitToEarn: '3997.50',
        },
        range: {
          disbursements: 0,
          accountAmount: '0.00',
          invested: '0.00',
          profit: '0.00',
          returned: '1350.00',
          profitEarned: '202.50',
        },
      });

      // The capital went out on Saturday: a range that holds it says so.
      const week = await w.investment.view(
        w.admin,
        { from: SATURDAY, to: MONDAY },
        MONDAY_EVENING,
      );
      expect(week.totals!.range).toEqual({
        disbursements: 4,
        accountAmount: '28000.00',
        invested: '23800.00',
        profit: '4200.00',
        returned: '1350.00',
        profitEarned: '202.50',
      });
      expect(rowOf(week, w.lineC.id).range).toEqual({
        disbursements: 1,
        accountAmount: '6000.00',
        invested: '5100.00',
        profit: '900.00',
        returned: '300.00',
        profitEarned: '45.00',
      });
      // By line code, as every report lists lines.
      expect(report.lines!.map((row) => row.code)).toEqual(
        report.lines!.map((row) => row.code).sort((a, b) => a.localeCompare(b)),
      );
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  /**
   * BR-18's own uneven example: `A = 9,999`, `I = 8,500`, `P = 1,499`, ₹100 a
   * day. Collections 1–3 recognise ₹14.99 and the fourth ₹15.00, so profit
   * earned after four days is exactly ₹59.97 — not 4 × 15% of ₹100 (₹60.00),
   * and not 4 × ₹14.99 (₹59.96).
   */
  async function unevenAccount(w: Awaited<ReturnType<typeof businessWorld>>) {
    const customer = await w.tx.customer.create({
      data: {
        organizationId: w.organizationId,
        customerCode: `C-${randomUUID()}`,
        name: 'Uneven',
        mobile: '+919800000002',
        address: '12 Market Road',
        sectorId: w.south.id,
        lineId: w.lineC.id,
        linePeriods: openLinePeriod(w.lineC.id),
      },
    });
    return w.accounts.create(
      w.admin,
      {
        customerId: customer.id,
        accountAmount: '9999.00',
        investedAmount: '8500.00',
        dailyAmount: '100.00',
        termDays: 100,
        disbursementDate: SATURDAY,
        disburse: true,
      },
      SATURDAY,
    );
  }

  it('US-035: a written-off account is not money returned — what it never repaid leaves the position, and its unearned profit with it', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await unevenAccount(w);
      await w.collect(w.juniorC, account.id, '100', MONDAY);

      const before = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY, lineId: w.lineC.id },
        THURSDAY_EVENING,
      );
      const lineBefore = before.lines!.find(
        (line) => line.lineId === w.lineC.id,
      )!;

      await w.accounts.close(
        w.admin,
        account.id,
        { status: 'WRITTEN_OFF', note: 'Shop closed; customer moved away' },
        MONDAY,
      );

      const after = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY, lineId: w.lineC.id },
        THURSDAY_EVENING,
      );
      const lineAfter = after.lines!.find(
        (line) => line.lineId === w.lineC.id,
      )!;

      // The ₹100 that really arrived is still returned, and the profit it
      // earned is still earned: only what was given up leaves the figures.
      expect(lineAfter.position!.returned).toBe(lineBefore.position!.returned);
      expect(lineAfter.position!.profitEarned).toBe(
        lineBefore.position!.profitEarned,
      );
      // Nothing is outstanding any more, and nothing is left to earn.
      expect(lineAfter.position!.outstanding).toBe('0.00');
      expect(lineAfter.position!.profitToEarn).toBe('0.00');
    });
  });

  it('recognises profit per BR-18 on the running total, to the paisa, for an uneven account amount', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await unevenAccount(w);
      for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY]) {
        await w.collect(w.juniorC, account.id, '100', day);
      }

      const report = await w.investment.view(
        w.admin,
        { from: MONDAY, to: THURSDAY, lineId: w.lineC.id },
        THURSDAY_EVENING,
      );
      expect(rowOf(report, w.lineC.id)).toMatchObject({
        position: {
          accounts: 1,
          accountAmount: '9999.00',
          invested: '8500.00',
          profit: '1499.00',
          outstanding: '9599.00',
          returned: '400.00',
          // round(400 × 1499 / 9999) = 59.97, the ledger's own figure.
          profitEarned: '59.97',
          profitToEarn: '1439.03',
        },
        range: {
          disbursements: 0,
          returned: '400.00',
          profitEarned: '59.97',
        },
      });

      // The three days before Thursday recognised ₹14.99 each; Thursday ₹15.00.
      const first = await w.investment.view(
        w.admin,
        { from: MONDAY, to: WEDNESDAY, lineId: w.lineC.id },
        THURSDAY_EVENING,
      );
      expect(rowOf(first, w.lineC.id).range).toMatchObject({
        returned: '300.00',
        profitEarned: '44.97',
      });
      const fourth = await w.investment.view(
        w.admin,
        { from: parseCalendarDate(THURSDAY), to: parseCalendarDate(THURSDAY) },
        THURSDAY_EVENING,
      );
      expect(rowOf(fourth, w.lineC.id).range).toMatchObject({
        returned: '100.00',
        profitEarned: '15.00',
      });

      // The period's profit is what EARNED_PROFIT actually moved, not a share.
      const earned = await tx.ledgerEntry.aggregate({
        where: {
          direction: 'CREDIT',
          ledgerAccount: {
            organizationId: w.organizationId,
            accountType: 'EARNED_PROFIT',
          },
        },
        _sum: { amount: true },
      });
      expect(report.totals!.range!.profitEarned).toBe(
        toMoney((earned._sum.amount ?? 0).toString()).toFixed(2),
      );
    });
  });

  it('an approved correction takes money and profit back out of the period (US-044)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await unevenAccount(w);
      const first = await w.collect(w.juniorC, account.id, '100', MONDAY);
      for (const day of [TUESDAY, WEDNESDAY, THURSDAY]) {
        await w.collect(w.juniorC, account.id, '100', day);
      }
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
      // Line C's Junior asks, an Admin decides — never the same person (US-044).
      const requested = await corrections.request(
        w.juniorC,
        first.collection.id,
        { correctedAmount: '80', reason: 'Paid 80, typed 100' },
        THURSDAY_EVENING,
      );
      await corrections.decide(
        w.admin,
        requested.id,
        { decision: 'APPROVED', note: 'Checked the note' },
        THURSDAY_EVENING,
      );

      const report = await w.investment.view(
        w.admin,
        { from: MONDAY, to: THURSDAY, lineId: w.lineC.id },
        THURSDAY_EVENING,
      );
      // ₹380 of ₹9,999 collected: round(380 × 1499 / 9999) = ₹56.97, so the
      // adjustment posted −₹3.00 against Thursday's ₹15.00.
      expect(rowOf(report, w.lineC.id)).toMatchObject({
        position: {
          outstanding: '9619.00',
          returned: '380.00',
          profitEarned: '56.97',
          profitToEarn: '1442.03',
        },
        range: { returned: '380.00', profitEarned: '56.97' },
      });
    });
  });

  it('a range is the sum of its days, to the paisa', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const account = await unevenAccount(w);
      const busy = await w.account(w.line.id, w.north, '333.33');
      await w.collect(w.juniorC, account.id, '100', MONDAY);
      await w.collect(w.juniorC, account.id, '100', WEDNESDAY);
      await w.collect(w.junior, busy.id, '333.34', TUESDAY);
      await w.collect(w.junior, busy.id, '0.99', THURSDAY);

      // Saturday 3 to Thursday 8 January, Sunday 4 inside it and carrying nothing.
      const from = SATURDAY;
      const to = parseCalendarDate(THURSDAY);
      const range = await w.investment.view(
        w.admin,
        { from, to },
        THURSDAY_EVENING,
      );

      const FIGURES = [
        'accountAmount',
        'invested',
        'profit',
        'returned',
        'profitEarned',
      ] as const;
      type Figures = Record<
        (typeof FIGURES)[number],
        ReturnType<typeof toMoney>
      >;
      const zero = (): Figures => ({
        accountAmount: toMoney('0'),
        invested: toMoney('0'),
        profit: toMoney('0'),
        returned: toMoney('0'),
        profitEarned: toMoney('0'),
      });
      const summed = new Map<string, Figures>();
      let days = 0;
      for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
        const day = await w.investment.view(
          w.admin,
          { from: date, to: date },
          THURSDAY_EVENING,
        );
        days += 1;
        for (const row of day.lines!) {
          const total = summed.get(row.lineId) ?? zero();
          for (const figure of FIGURES) {
            total[figure] = total[figure].plus(row.range![figure]);
          }
          summed.set(row.lineId, total);
        }
      }
      expect(days).toBe(6);
      for (const row of range.lines!) {
        const total = summed.get(row.lineId)!;
        expect(row.range).toMatchObject(
          Object.fromEntries(
            FIGURES.map((figure) => [figure, total[figure].toFixed(2)]),
          ),
        );
      }
      // ₹333.34 and ₹0.99 against a ₹333.33-a-day account: nothing round.
      expect(rowOf(range, w.line.id).range).toMatchObject({
        returned: '334.33',
        invested: '5666.61',
      });
      // Nothing about the position depends on the range.
      const monday = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        THURSDAY_EVENING,
      );
      for (const row of range.lines!) {
        expect(rowOf(monday, row.lineId).position).toEqual(row.position);
      }
    });
  });

  it('for one day, its account amount, invested and profit are the line-wise report’s and the overview’s', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const report = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );
      const lineWise = await w.lineWise.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );
      const overview = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);

      expect(report.lines!.map((row) => row.lineId)).toEqual(
        lineWise.lines!.map((row) => row.lineId),
      );
      for (const row of report.lines!) {
        const sameLine = lineWise.lines!.find(
          (line) => line.lineId === row.lineId,
        )!;
        expect({
          accountAmount: row.position!.accountAmount,
          invested: row.position!.invested,
          profit: row.position!.profit,
        }).toEqual(sameLine.amounts);
      }
      expect({
        accountAmount: report.totals!.position!.accountAmount,
        invested: report.totals!.position!.invested,
        profit: report.totals!.position!.profit,
      }).toEqual(overview.totals);
      expect(report.totals!.position!.accounts).toBe(
        overview.accounts!.active + overview.accounts!.completed,
      );
      // Money returned is the collections the ledger holds, not the day's figure.
      expect(report.totals!.range!.returned).toBe(overview.today!.collected);
    });
  });

  it('a Senior sees only their own line — with its invested and profit — and another line or sector is 404', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const range = { from: MONDAY, to: MONDAY };
      const admin = await w.investment.view(w.admin, range, MONDAY_EVENING);
      const own = await w.investment.view(w.senior, range, MONDAY_EVENING);

      expect(own.lines).toEqual([rowOf(admin, w.line.id)]);
      expect(own.lines![0]!.position).toMatchObject({
        invested: '17000.00',
        profit: '3000.00',
        profitEarned: '135.00',
      });
      expect(own.totals).toEqual({
        lines: 1,
        position: own.lines![0]!.position,
        range: own.lines![0]!.range,
      });

      await expect(
        w.investment.view(
          w.senior,
          { ...range, lineId: w.otherLine.id },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.investment.view(
          w.senior,
          { ...range, sectorId: w.south.id },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });

      // A Senior with no line today sees no lines, not everyone's.
      const unassigned = await w.investment.view(
        { ...w.senior, currentLineId: null },
        range,
        MONDAY_EVENING,
      );
      expect(unassigned.lines).toEqual([]);
      expect(unassigned.totals).toMatchObject({
        lines: 0,
        position: { accounts: 0, invested: '0.00', profitEarned: '0.00' },
      });
    });
  });

  it('S-07: a group that cannot be read is null on every row and in the totals, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const logger = { error: vi.fn() };
      const view = (model: string, method: string) =>
        new InvestmentReportService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        ).view(w.admin, { from: MONDAY, to: MONDAY }, MONDAY_EVENING);

      // The receivable balances alone: the period's postings still stand.
      const noPosition = await view('ledgerAccount', 'findMany');
      expect(noPosition.lines).toHaveLength(3);
      for (const row of noPosition.lines!) {
        expect(row.position).toBeNull();
        expect(row.range).not.toBeNull();
      }
      expect(noPosition.totals).toMatchObject({
        lines: 3,
        position: null,
        range: { returned: '1350.00' },
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: investment',
      );

      const noLedger = await view('ledgerEntry', 'findMany');
      expect(
        noLedger.lines!.every(
          (row) => row.position === null && row.range === null,
        ),
      ).toBe(true);
      expect(noLedger.totals).toMatchObject({ position: null, range: null });

      const noLines = await view('line', 'findMany');
      expect(noLines).toMatchObject({ lines: null, totals: null });
    });
  });

  it('lists an inactive line that still carries an investment, and refuses a bad range or another organization’s line', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const unused = await tx.line.create({
        data: {
          organizationId: w.organizationId,
          sectorId: w.north,
          code: `L-${randomUUID()}`,
          name: 'Unused',
          isActive: false,
        },
      });
      await tx.line.update({
        where: { id: w.otherLine.id },
        data: { isActive: false },
      });

      const listed = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY },
        MONDAY_EVENING,
      );
      // Line B is closed but still holds ₹2,000 of book; the unused one holds none.
      expect(listed.lines!.map((row) => row.lineId).sort()).toEqual(
        [w.line.id, w.otherLine.id, w.lineC.id].sort(),
      );
      expect(rowOf(listed, w.otherLine.id)).toMatchObject({
        isActive: false,
        position: { accountAmount: '2000.00' },
      });
      const asked = await w.investment.view(
        w.admin,
        { from: MONDAY, to: MONDAY, lineId: unused.id },
        MONDAY_EVENING,
      );
      expect(asked.lines).toHaveLength(1);
      expect(asked.lines![0]).toMatchObject({
        isActive: false,
        position: { accounts: 0, accountAmount: '0.00' },
        range: { disbursements: 0, returned: '0.00' },
      });

      await expect(
        w.investment.view(w.admin, { to: '2026-01-09' }, MONDAY_EVENING),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
      await expect(
        w.investment.view(
          w.admin,
          { from: '2025-10-01', to: '2026-01-05' },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });
      // No range: the month so far.
      const month = await w.investment.view(w.admin, {}, MONDAY_EVENING);
      expect([month.from, month.to]).toEqual(['2026-01-01', '2026-01-05']);

      const other = await createLine(tx);
      await expect(
        w.investment.view(w.admin, { lineId: other.line.id }, MONDAY_EVENING),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.investment.view(
          w.admin,
          { sectorId: other.sector.id },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });
      expect(month.lines!.map((row) => row.lineId)).not.toContain(
        other.line.id,
      );
    });
  });
});
