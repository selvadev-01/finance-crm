import type { OverdueReport } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { lineRangeFigures } from '../../src/cash/line-day-figures.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { readArrearsByAccount } from '../../src/dashboards/business-figures.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { Database } from '../../src/platform/database/database.js';
import { OverdueReportService } from '../../src/reports/overdue-report.service.js';
import { SettingReader } from '../../src/settings/setting-reader.js';
import { at, SATURDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine } from '../db-constraints/fixtures.js';
import { businessWorld } from '../dashboards/business-world.js';
import { withRollback } from '../with-rollback.js';

/**
 * The overdue report (M12, US-087) against real rows, rolled back — it reads
 * disbursements and collections, whose ledger rows reject DELETE.
 *
 * The calendar every example below counts on: accounts are disbursed on
 * Saturday 3 January 2026, so the first slot is **Monday 5** (BR-03, Sunday 4
 * is not a working day). **Tuesday 6 January is a declared holiday** in these
 * tests, and **Sunday 11** is a Sunday, so neither carries a schedule slot at
 * all (BR-02, BR-04) — a ₹100-a-day account with six slots is due on
 * 5, 7, 8, 9, 10 and 12 January and its target completion date is Monday 12.
 */
describe('OverdueReportService (US-087)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const MONDAY = parseCalendarDate('2026-01-05');
  const WEDNESDAY = parseCalendarDate('2026-01-07');
  /** Two days after the six-slot accounts' target completion date. */
  const ASOF = parseCalendarDate('2026-01-14');
  const NOW = at(ASOF, '11:00:00');
  const page = { limit: 50, sort: 'daysOverdue' } as const;

  type Row = OverdueReport['data'][number];
  const rowOf = (report: OverdueReport, accountLoanId: string): Row =>
    report.data.find((row) => row.accountLoanId === accountLoanId)!;

  type World = Awaited<ReturnType<typeof businessWorld>>;

  /** A disbursed account of `slots` days at `daily`, on the line given. */
  async function account(
    w: World,
    options: { lineId: string; sectorId: string; daily: string; slots: number },
  ) {
    const amount = toMoney(options.daily).times(options.slots);
    const customer = await w.tx.customer.create({
      data: {
        organizationId: w.organizationId,
        customerCode: `C-${randomUUID()}`,
        name: 'Customer',
        mobile: '+919800000001',
        address: '12 Market Road',
        sectorId: options.sectorId,
        lineId: options.lineId,
      },
    });
    return w.accounts.create(
      w.admin,
      {
        customerId: customer.id,
        accountAmount: amount.toFixed(2),
        investedAmount: amount.times('0.85').toFixed(2),
        dailyAmount: options.daily,
        termDays: options.slots,
        disbursementDate: SATURDAY,
        disburse: true,
      },
      SATURDAY,
    );
  }

  /** The world with Tuesday 6 January declared a business-wide holiday. */
  async function overdueWorld(tx: PrismaClient) {
    const w = await businessWorld(tx);
    await tx.holiday.create({
      data: {
        organizationId: w.organizationId,
        sectorId: null,
        date: new Date('2026-01-06'),
        name: 'Pongal',
      },
    });
    return w;
  }

  it('Scenario: a Sunday and a declared holiday put nobody in arrears', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const silent = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });

      // The plan skipped both non-working days, so no day expects anything.
      const due = await tx.accountSchedule.findMany({
        where: { accountLoanId: silent.id },
        select: { dueDate: true, expectedAmount: true },
        orderBy: { sequence: 'asc' },
      });
      expect(
        due.map((slot) => slot.dueDate.toISOString().slice(0, 10)),
      ).toEqual([
        '2026-01-05',
        '2026-01-07',
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-12',
      ]);

      const report = await w.overdue.view(w.admin, page, NOW);
      expect(report).toMatchObject({
        asOf: ASOF,
        generatedAt: NOW.toISOString(),
        hasMore: false,
        nextCursor: null,
      });
      expect(rowOf(report, silent.id)).toEqual({
        accountLoanId: silent.id,
        accountCode: silent.accountCode,
        customerId: silent.customerId,
        customerName: 'Customer',
        lineId: w.line.id,
        lineCode: w.line.code,
        lineName: 'Line',
        sectorId: w.north,
        sectorName: 'Sector',
        dailyAmount: '100.00',
        accountAmount: '600.00',
        outstanding: '600.00',
        targetCompletionDate: '2026-01-12',
        // 12 → 14 January, in calendar days.
        daysOverdue: 2,
        arrears: {
          // Nine calendar days from the first slot to today, six of them due:
          // the holiday and the Sunday are not days this account owes money on.
          amount: '600.00',
          unpaidDays: 6,
          lastCollection: null,
        },
      });
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('Scenario: arrears are BR-16’s pending per day, so a surplus never erases an earlier shortfall', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const behind = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      // Monday: a visit with nothing paid (BR-08's NO_PAYMENT). Wednesday: ₹200
      // — the balance catches up, the calendar does not.
      await w.collect(w.junior, behind.id, '0', MONDAY);
      await w.collect(w.junior, behind.id, '200', WEDNESDAY);

      const report = await w.overdue.view(w.admin, page, NOW);
      const row = rowOf(report, behind.id);
      expect(row.outstanding).toBe('400.00');
      expect(row.arrears).toEqual({
        // ₹100 short on Monday, square on Wednesday, ₹100 a day unpaid after.
        amount: '500.00',
        unpaidDays: 5,
        lastCollection: {
          businessDate: '2026-01-07',
          amount: '200.00',
          daysAgo: 7,
        },
      });
      // Arrears and outstanding answer different questions: ₹400 is still
      // owed, ₹500 is what the plan asked for and did not get.
      expect(row.arrears!.amount).not.toBe(row.outstanding);
    });
  });

  it('lists nobody who is up to date or paid ahead', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const onPlan = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 10,
      });
      for (const day of [
        '2026-01-05',
        '2026-01-07',
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-12',
        '2026-01-13',
        '2026-01-14',
      ]) {
        await w.collect(w.junior, onPlan.id, '100', day);
      }
      const ahead = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      await w.collect(w.junior, ahead.id, '600', MONDAY);

      const report = await w.overdue.view(w.admin, page, NOW);
      expect(report.data).toEqual([]);
      expect(report.summary).toEqual({
        accounts: 0,
        lines: 0,
        outstanding: '0.00',
        arrears: '0.00',
        longestOverdue: null,
      });
      // The one that paid every due day is still running and still on time.
      const paying = await tx.accountLoan.findUniqueOrThrow({
        where: { id: onPlan.id },
        select: { status: true, isOverdue: true, targetCompletionDate: true },
      });
      expect(paying.status).toBe('ACTIVE');
      expect(paying.targetCompletionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-16',
      );
      // The one that paid it all off completed (BR-05).
      const done = await tx.accountLoan.findUniqueOrThrow({
        where: { id: ahead.id },
        select: { status: true, outstandingAmount: true },
      });
      expect(done.status).toBe('COMPLETED');
      expect(done.outstandingAmount.toFixed(2)).toBe('0.00');
    });
  });

  it('an approved correction moves the arrears, on the day it landed (US-044)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const corrected = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      const paid = await w.collect(w.junior, corrected.id, '100', MONDAY);
      // Later than the six-slot target, so the account is overdue either way
      // and only the correction moves the figures.
      const later = at('2026-01-16', '11:00:00');

      const before = rowOf(
        await w.overdue.view(w.admin, page, later),
        corrected.id,
      );
      expect(before.outstanding).toBe('500.00');
      expect(before.arrears).toMatchObject({
        amount: '500.00',
        unpaidDays: 5,
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
      // The Junior asks on Wednesday, an Admin decides — never the same person.
      const requested = await corrections.request(
        w.junior,
        paid.collection.id,
        { correctedAmount: '40', reason: 'Paid 40, typed 100' },
        at(WEDNESDAY, '19:00:00'),
      );
      await corrections.decide(
        w.admin,
        requested.id,
        { decision: 'APPROVED', note: 'Checked the note' },
        at(WEDNESDAY, '20:00:00'),
      );

      const after = rowOf(
        await w.overdue.view(w.admin, page, later),
        corrected.id,
      );
      expect(after.outstanding).toBe('560.00');
      // The −₹60 carries Wednesday's own business date, as every figure that
      // reads collections by date does (BR-15), so Wednesday is ₹160 short —
      // and BR-06 regenerated the tail for the ₹560 now outstanding.
      expect(after.arrears!.amount).toBe('560.00');
      expect(
        toMoney(after.arrears!.amount).minus(before.arrears!.amount).toFixed(2),
      ).toBe('60.00');
    });
  });

  it('is the day close’s own pending, read per account (BR-16)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const first = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      const second = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      // ₹60 against ₹100 on Monday, and nothing from the second customer.
      await w.collect(w.junior, first.id, '60', MONDAY);

      // For one day on which nobody overpaid, the accounts' arrears are the
      // line's shortfall exactly — the figure the day close (S-05) and the
      // line-wise report both read.
      const perAccount = await readArrearsByAccount(
        tx,
        [first.id, second.id],
        MONDAY,
      );
      const perLine = await lineRangeFigures(tx, [w.line.id], MONDAY, MONDAY);
      const summed = [...perAccount.values()].reduce(
        (total, entry) => total.plus(entry.amount),
        toMoney('0'),
      );
      expect(summed.toFixed(2)).toBe('140.00');
      expect(summed.toFixed(2)).toBe(
        perLine.get(w.line.id)!.shortfall.toFixed(2),
      );

      // By the 14th: ₹60 short on Monday, and the tail BR-06 regenerated for
      // the remaining ₹540 — six more days of 100, 100, 100, 100, 100 and 40.
      const report = await w.overdue.view(w.admin, page, NOW);
      expect(rowOf(report, first.id).arrears).toMatchObject({
        amount: '580.00',
        unpaidDays: 7,
      });
      expect(rowOf(report, second.id).arrears).toMatchObject({
        amount: '600.00',
        unpaidDays: 6,
      });
      expect(report.summary).toMatchObject({ arrears: '1180.00' });
    });
  });

  it('orders by days overdue or by outstanding, and pages without repeating a row', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const small = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      const large = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '300',
        slots: 6,
      });
      // Four slots: due 5, 7, 8 and 9 January, so overdue by five days.
      const older = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 4,
      });

      const byDays = await w.overdue.view(w.admin, page, NOW);
      expect(byDays.data.map((row) => row.accountLoanId)).toEqual([
        older.id,
        ...[small.id, large.id].sort((a, b) => a.localeCompare(b)),
      ]);
      expect(byDays.data.map((row) => row.daysOverdue)).toEqual([5, 2, 2]);

      const byOutstanding = await w.overdue.view(
        w.admin,
        { ...page, sort: 'outstanding' },
        NOW,
      );
      expect(byOutstanding.data.map((row) => row.outstanding)).toEqual([
        '1800.00',
        '600.00',
        '400.00',
      ]);

      // One row at a time: every account exactly once, in the same order.
      for (const sort of ['daysOverdue', 'outstanding'] as const) {
        const whole = await w.overdue.view(w.admin, { ...page, sort }, NOW);
        const walked: string[] = [];
        let cursor: string | undefined;
        do {
          const step: OverdueReport = await w.overdue.view(
            w.admin,
            { limit: 1, sort, ...(cursor ? { cursor } : {}) },
            NOW,
          );
          expect(step.data).toHaveLength(1);
          expect(step.summary!.accounts).toBe(3);
          walked.push(step.data[0]!.accountLoanId);
          cursor = step.nextCursor ?? undefined;
        } while (cursor !== undefined);
        expect(walked).toEqual(whole.data.map((row) => row.accountLoanId));
      }
    });
  });

  it('summarises the whole set, not the page, and narrows by days overdue, sector and line', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const onLine = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      const elsewhere = await account(w, {
        lineId: w.lineC.id,
        sectorId: w.south.id,
        daily: '100',
        slots: 4,
      });

      const all = await w.overdue.view(w.admin, page, NOW);
      expect(all.summary).toEqual({
        accounts: 2,
        lines: 2,
        outstanding: '1000.00',
        arrears: '1000.00',
        longestOverdue: {
          accountLoanId: elsewhere.id,
          accountCode: elsewhere.accountCode,
          customerName: 'Customer',
          daysOverdue: 5,
        },
      });

      // One row a page: the band still covers both accounts.
      const firstPage = await w.overdue.view(
        w.admin,
        { ...page, limit: 1 },
        NOW,
      );
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.summary).toEqual(all.summary);

      const long = await w.overdue.view(
        w.admin,
        { ...page, minDaysOverdue: 5 },
        NOW,
      );
      expect(long.data.map((row) => row.accountLoanId)).toEqual([elsewhere.id]);
      expect(long.summary).toMatchObject({ accounts: 1, lines: 1 });
      const none = await w.overdue.view(
        w.admin,
        { ...page, minDaysOverdue: 6 },
        NOW,
      );
      expect(none.data).toEqual([]);

      const north = await w.overdue.view(
        w.admin,
        { ...page, sectorId: w.north },
        NOW,
      );
      expect(north.data.map((row) => row.accountLoanId)).toEqual([onLine.id]);
      const lineC = await w.overdue.view(
        w.admin,
        { ...page, lineId: w.lineC.id },
        NOW,
      );
      expect(lineC.data.map((row) => row.accountLoanId)).toEqual([
        elsewhere.id,
      ]);
      expect(lineC.summary).toMatchObject({ accounts: 1, arrears: '400.00' });
    });
  });

  it('a Senior sees their own line only; another line or sector is 404, and a bad cursor is 400', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const mine = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      await account(w, {
        lineId: w.lineC.id,
        sectorId: w.south.id,
        daily: '100',
        slots: 6,
      });

      const own = await w.overdue.view(w.senior, page, NOW);
      expect(own.data.map((row) => row.accountLoanId)).toEqual([mine.id]);
      expect(own.summary).toMatchObject({ accounts: 1, lines: 1 });

      await expect(
        w.overdue.view(w.senior, { ...page, lineId: w.lineC.id }, NOW),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      await expect(
        w.overdue.view(w.senior, { ...page, sectorId: w.south.id }, NOW),
      ).rejects.toMatchObject({ code: 'SECTOR_NOT_FOUND', status: 404 });

      const unassigned = await w.overdue.view(
        { ...w.senior, currentLineId: null },
        page,
        NOW,
      );
      expect(unassigned.data).toEqual([]);
      expect(unassigned.summary).toMatchObject({ accounts: 0, lines: 0 });

      // Another organization's line is gone, as a line that never existed is.
      const other = await createLine(tx);
      await expect(
        w.overdue.view(w.admin, { ...page, lineId: other.line.id }, NOW),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });

      await expect(
        w.overdue.view(w.admin, { ...page, cursor: 'not-a-cursor' }, NOW),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 });
    });
  });

  it('S-07: a group that cannot be read is null, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await overdueWorld(tx);
      const silent = await account(w, {
        lineId: w.line.id,
        sectorId: w.north,
        daily: '100',
        slots: 6,
      });
      const logger = { error: vi.fn() };
      const view = (client: PrismaClient) => {
        const database = new Database(client);
        return new OverdueReportService(
          database,
          logger as unknown as PinoLogger,
          new SettingReader(database),
        ).view(w.admin, page, NOW);
      };

      // The schedule read fails: the rows stand, their arrears do not.
      const noArrears = await view(withoutRawQueries(tx));
      expect(noArrears.data).toHaveLength(1);
      expect(rowOf(noArrears, silent.id)).toMatchObject({
        outstanding: '600.00',
        arrears: null,
      });
      expect(noArrears.summary).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: arrears',
      );

      // The band's own read fails: the rows and their arrears stand.
      const noSummary = await view(failingSecondFindMany(tx));
      expect(rowOf(noSummary, silent.id).arrears).toMatchObject({
        amount: '600.00',
      });
      expect(noSummary.summary).toBeNull();
    });
  });
});

/**
 * A client whose raw queries reject, every Prisma model still working — so
 * only the arrears read fails (S-07, one group at a time).
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

/**
 * A client whose **second** `accountLoan.findMany` rejects: the page's rows
 * are read, the summary band's whole-set read is not.
 */
function failingSecondFindMany(tx: PrismaClient): PrismaClient {
  let seen = 0;
  return new Proxy(tx, {
    get(target, property) {
      if (property !== 'accountLoan') {
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const delegate = Reflect.get(target, property) as object;
      return new Proxy(delegate, {
        get(inner, name) {
          const value: unknown = Reflect.get(inner, name);
          if (name !== 'findMany' || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(inner) : value;
          }
          return (...args: unknown[]) => {
            seen += 1;
            return seen > 1
              ? Promise.reject(new Error('connection lost'))
              : (value as (...a: unknown[]) => unknown).apply(inner, args);
          };
        },
      });
    },
  });
}
