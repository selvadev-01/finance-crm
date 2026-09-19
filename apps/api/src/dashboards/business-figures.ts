import type {
  DayKind,
  LineToday,
  SectorDay,
  SectorOverview,
  SectorTally,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  dayOfWeek,
  fromUtcMidnight,
  recognisedProfit,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';

import {
  accountScope,
  assignmentInEffectOn,
  customerScope,
  holidayScope,
  inScope,
  lineScope,
  sectorScope,
} from '../access/scope.js';
import { lineDayFigures } from '../cash/line-day-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { DomainError } from '../platform/errors/errors.js';

/**
 * M11 — the figures the business-wide dashboards share: the Super Admin
 * overview (US-080, S-07), the sector comparison (US-081) and the Admin
 * operational dashboard (US-082, S-20). All read them from here, so the
 * screens cannot disagree about today's money, the sectors' tally, the
 * account counts or the ledger's totals.
 *
 * Every reader takes the caller's `RequestContext` and filters through its
 * scope (M02).
 */

export type Tx = Prisma.TransactionClient;
export type Decimal = ReturnType<typeof toMoney>;
export type Holiday = { sectorId: string | null; name: string };

/**
 * Runs one group's queries; a failure becomes `null` for that group alone,
 * logged with the request so it can be traced (S-07's partial failure).
 */
export async function figureOrNull<T>(
  logger: PinoLogger,
  context: RequestContext,
  group: string,
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    logger.error(
      { err, requestId: context.requestId },
      `Dashboard figures unavailable: ${group}`,
    );
    return null;
  }
}

/** A dashboard shows today or an earlier business date: a later one is `422`. */
export function refuseFutureDate(
  date: CalendarDate,
  now: Date,
  message: string,
): void {
  if (date > toBusinessDate(now)) {
    throw new DomainError('DATE_IN_FUTURE', message, [
      { field: 'date', issue: 'is after today' },
    ]);
  }
}

/** Holidays on the date the caller observes: business-wide or per sector. */
export function readHolidays(
  tx: Tx,
  context: RequestContext,
  date: CalendarDate,
): Promise<Holiday[]> {
  return tx.holiday.findMany({
    where: inScope(holidayScope(context), { date: toUtcMidnight(date) }),
    select: { sectorId: true, name: true },
  });
}

/**
 * Each line's day: expected and collected from `cash/line-day-figures.ts` —
 * the function the day close (S-05) reads — with collections attributed by
 * `collection.lineId` (BR-15). Inactive lines appear only on a day they still
 * carry money.
 */
export async function readLines(
  tx: Tx,
  context: RequestContext,
  date: CalendarDate,
  holidays: Holiday[],
): Promise<LineToday[]> {
  const day = toUtcMidnight(date);
  const rows = await tx.line.findMany({
    where: inScope(lineScope(context)),
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      sector: { select: { id: true, code: true, name: true } },
      assignments: {
        where: assignmentInEffectOn(date),
        select: {
          assignmentRole: true,
          staffProfile: { select: { user: { select: { name: true } } } },
        },
      },
      dayCloses: { where: { businessDate: day }, select: { status: true } },
    },
    orderBy: { code: 'asc' },
  });
  const ids = rows.map((line) => line.id);
  const figures = await lineDayFigures(tx, ids, date);

  const classified = await tx.collection.groupBy({
    by: ['lineId', 'classification'],
    where: {
      lineId: { in: ids },
      businessDate: day,
      status: 'CONFIRMED',
      entryType: 'ORIGINAL',
      classification: { in: ['LOW', 'EXTRA'] },
    },
    _count: { _all: true },
  });
  const classifiedCount = (lineId: string, kind: 'LOW' | 'EXTRA') =>
    classified.find(
      (row) => row.lineId === lineId && row.classification === kind,
    )?._count._all ?? 0;

  // Accounts follow their customer's current line (M02 accountScope).
  const active = await tx.accountLoan.findMany({
    where: inScope(accountScope(context), {
      status: 'ACTIVE',
      customer: { lineId: { in: ids } },
    }),
    select: { customer: { select: { lineId: true } } },
  });
  const activeOn = new Map<string, number>();
  for (const account of active) {
    const lineId = account.customer.lineId;
    activeOn.set(lineId, (activeOn.get(lineId) ?? 0) + 1);
  }

  return rows
    .map((line): LineToday => {
      const money = figures.get(line.id)!;
      const senior = line.assignments.find(
        (assignment) => assignment.assignmentRole === 'SENIOR',
      );
      return {
        lineId: line.id,
        code: line.code,
        name: line.name,
        isActive: line.isActive,
        sectorId: line.sector.id,
        sectorCode: line.sector.code,
        sectorName: line.sector.name,
        day: dayKind(date, holidays, line.sector.id),
        status: line.dayCloses[0]?.status ?? 'OPEN',
        expected: money.expected.toFixed(2),
        collected: money.collected.toFixed(2),
        missedCount: money.missed,
        lowCount: classifiedCount(line.id, 'LOW'),
        extraCount: classifiedCount(line.id, 'EXTRA'),
        seniorName: senior?.staffProfile.user.name ?? null,
        juniorCount: line.assignments.filter(
          (assignment) => assignment.assignmentRole === 'JUNIOR',
        ).length,
        activeAccounts: activeOn.get(line.id) ?? 0,
      };
    })
    .filter(
      // An inactive line stays on the day it still carries money.
      (line) =>
        line.isActive ||
        !toMoney(line.expected).isZero() ||
        !toMoney(line.collected).isZero(),
    );
}

/** Accounts by status, all time. */
export async function readAccountCounts(tx: Tx, context: RequestContext) {
  const byStatus = await tx.accountLoan.groupBy({
    by: ['status'],
    where: inScope(accountScope(context)),
    _count: { _all: true },
  });
  const of = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    active: of('ACTIVE'),
    completed: of('COMPLETED'),
  };
}

/**
 * BR-18: a disbursement debits the account's `LOAN_RECEIVABLE` with `A` and
 * credits `CASH_AT_OFFICE` with `I` and `UNEARNED_PROFIT` with `P`. Reading
 * those postings, not the account rows, keeps the dashboards on the figures
 * the nightly reconciliation checks. Ledger accounts carry the organization,
 * which is the scope for business totals (`money.businessTotals`).
 */
export async function readDisbursedTotals(tx: Tx, context: RequestContext) {
  const disbursed = (
    accountType: 'LOAN_RECEIVABLE' | 'CASH_AT_OFFICE' | 'UNEARNED_PROFIT',
    direction: 'DEBIT' | 'CREDIT',
  ) =>
    tx.ledgerEntry.aggregate({
      where: {
        direction,
        ledgerAccount: { organizationId: context.organizationId, accountType },
        ledgerTransaction: { transactionType: 'DISBURSEMENT' },
      },
      _sum: { amount: true },
    });
  const money = (sum: { _sum: { amount: { toString(): string } | null } }) =>
    toMoney((sum._sum.amount ?? 0).toString()).toFixed(2);
  const accountAmount = await disbursed('LOAN_RECEIVABLE', 'DEBIT');
  const invested = await disbursed('CASH_AT_OFFICE', 'CREDIT');
  const profit = await disbursed('UNEARNED_PROFIT', 'CREDIT');
  return {
    accountAmount: money(accountAmount),
    invested: money(invested),
    profit: money(profit),
  };
}

/** Sunday, a holiday for every sector, or one for `sectorId`'s sector (M06). */
export function dayKind(
  date: CalendarDate,
  holidays: Holiday[],
  sectorId: string | null,
): DayKind {
  if (dayOfWeek(date) === 0) return { kind: 'SUNDAY' };
  const holiday =
    holidays.find((row) => row.sectorId === null) ??
    (sectorId ? holidays.find((row) => row.sectorId === sectorId) : undefined);
  return holiday
    ? { kind: 'HOLIDAY', name: holiday.name }
    : { kind: 'WORKING' };
}

/**
 * The last `count` working days ending on `to`, oldest first (M06): a date is
 * skipped when it is a Sunday, a business-wide holiday, or a holiday for
 * **every** sector in `sectorIds` — a sector holiday leaves the other sectors
 * collecting, as {@link dayKind} reads it per line. With no sectors, only
 * Sundays and business-wide holidays are skipped.
 *
 * Holidays are read once for the whole window, through the caller's scope.
 */
export async function workingDates(
  tx: Tx,
  context: RequestContext,
  sectorIds: readonly string[],
  to: CalendarDate,
  count: number,
): Promise<CalendarDate[]> {
  // Six working days a week, so twice the count plus a month of holidays is ample.
  const from = addCalendarDays(to, -(count * 2 + 31));
  const holidays = await tx.holiday.findMany({
    where: inScope(holidayScope(context), {
      date: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
    }),
    select: { date: true, sectorId: true },
  });
  const businessWide = new Set<CalendarDate>();
  const bySector = new Map<CalendarDate, Set<string>>();
  for (const holiday of holidays) {
    const date = fromUtcMidnight(holiday.date);
    if (holiday.sectorId === null) {
      businessWide.add(date);
      continue;
    }
    const sectors = bySector.get(date) ?? new Set<string>();
    sectors.add(holiday.sectorId);
    bySector.set(date, sectors);
  }
  const everySectorOff = (date: CalendarDate) => {
    if (sectorIds.length === 0) return false;
    const off = bySector.get(date);
    return off !== undefined && sectorIds.every((id) => off.has(id));
  };

  const dates: CalendarDate[] = [];
  for (
    let date = to;
    dates.length < count && date >= from;
    date = addCalendarDays(date, -1)
  ) {
    if (dayOfWeek(date) === 0) continue;
    if (businessWide.has(date) || everySectorOff(date)) continue;
    dates.push(date);
  }
  return dates.reverse();
}

/** The business-wide day when the holidays could not be read: Sunday is still known. */
export function businessDay(
  date: CalendarDate,
  holidays: Holiday[] | null,
): DayKind {
  if (holidays !== null) return dayKind(date, holidays, null);
  return dayOfWeek(date) === 0 ? { kind: 'SUNDAY' } : { kind: 'WORKING' };
}

export const ZERO = () => toMoney('0');

export function isClosed(status: LineToday['status']): boolean {
  return status === 'CLOSED' || status === 'TALLIED';
}

/** An active line with collections due that date — one that has a day to close. */
export function isCollecting(line: LineToday): boolean {
  return line.isActive && line.day.kind === 'WORKING';
}

/**
 * Money and counts summed over `lines`, BR-16 taken **per line**: a surplus
 * on one line never hides a shortfall on another.
 */
export function sumLines(lines: LineToday[]) {
  let expected: Decimal = ZERO();
  let collected: Decimal = ZERO();
  let pending: Decimal = ZERO();
  let extra: Decimal = ZERO();
  let lowCount = 0;
  let extraCount = 0;
  let linesToClose = 0;
  let linesClosed = 0;
  let linesTallied = 0;
  for (const line of lines) {
    const gap = toMoney(line.expected).minus(line.collected);
    expected = expected.plus(line.expected);
    collected = collected.plus(line.collected);
    // BR-16: a shortfall when expected exceeds collected, a surplus when collected exceeds expected.
    if (gap.greaterThan(0)) pending = pending.plus(gap);
    if (gap.lessThan(0)) extra = extra.minus(gap);
    lowCount += line.lowCount;
    extraCount += line.extraCount;
    if (isCollecting(line)) {
      linesToClose += 1;
      if (isClosed(line.status)) linesClosed += 1;
      if (line.status === 'TALLIED') linesTallied += 1;
    }
  }
  return {
    expected: expected.toFixed(2),
    collected: collected.toFixed(2),
    pending: pending.toFixed(2),
    extra: extra.toFixed(2),
    lowCount,
    extraCount,
    linesToClose,
    linesClosed,
    linesTallied,
  };
}

/** The lines grouped by sector, in sector-code order. */
export function linesBySector(lines: LineToday[]): LineToday[][] {
  const sectors = new Map<string, LineToday[]>();
  for (const line of lines) {
    const group = sectors.get(line.sectorId) ?? [];
    group.push(line);
    sectors.set(line.sectorId, group);
  }
  return [...sectors.values()].sort((a, b) =>
    a[0]!.sectorCode.localeCompare(b[0]!.sectorCode),
  );
}

/**
 * One sector's day from its lines (§23): money and counts summed with BR-16
 * taken per line, and the tally rolled up from the lines' day closes (§19).
 * An empty group is a sector with no line that day: zeros, NO_COLLECTIONS.
 */
export function sectorDay(lines: LineToday[]): SectorDay {
  const sum = sumLines(lines);
  return {
    expected: sum.expected,
    collected: sum.collected,
    shortfall: sum.pending,
    surplus: sum.extra,
    lowCount: sum.lowCount,
    extraCount: sum.extraCount,
    linesToClose: sum.linesToClose,
    linesClosed: sum.linesClosed,
    linesTallied: sum.linesTallied,
    tally: sectorTally(sum),
  };
}

/** US-080's sector rows: the sectors that have lines that day, by code. */
export function sectorRows(lines: LineToday[]): SectorOverview[] {
  return linesBySector(lines).map((group) => {
    const first = group[0]!;
    return {
      sectorId: first.sectorId,
      code: first.sectorCode,
      name: first.sectorName,
      lineCount: group.length,
      ...sectorDay(group),
    };
  });
}

/**
 * §19 per sector, over its collecting lines: all TALLIED is TALLIED, all
 * CLOSED or TALLIED is CLOSED, otherwise OPEN; none collecting is
 * NO_COLLECTIONS.
 */
export function sectorTally(sum: {
  linesToClose: number;
  linesClosed: number;
  linesTallied: number;
}): SectorTally {
  if (sum.linesToClose === 0) return 'NO_COLLECTIONS';
  if (sum.linesTallied === sum.linesToClose) return 'TALLIED';
  if (sum.linesClosed === sum.linesToClose) return 'CLOSED';
  return 'OPEN';
}

/**
 * §19: "Tally Completed 8; Extra Collection 2; Low Collection 2." Only the
 * sectors collecting that date count; a sector "had extra" when its per-line
 * surplus is above zero, and "had low collection" when its shortfall is.
 */
export function tallySummary(
  sectors: Pick<SectorDay, 'tally' | 'surplus' | 'shortfall'>[],
) {
  const collecting = sectors.filter(
    (sector) => sector.tally !== 'NO_COLLECTIONS',
  );
  return {
    collecting: collecting.length,
    tallied: collecting.filter((sector) => sector.tally === 'TALLIED').length,
    withExtra: collecting.filter((sector) => !toMoney(sector.surplus).isZero())
      .length,
    withLow: collecting.filter((sector) => !toMoney(sector.shortfall).isZero())
      .length,
  };
}

/**
 * The business's shape, now (§17): active sectors and lines, customers not
 * deleted. Setup is needed until a sector and a line exist.
 */
export async function readStructure(tx: Tx, context: RequestContext) {
  const sectors = await tx.sector.count({
    where: inScope(sectorScope(context), { isActive: true }),
  });
  const lines = await tx.line.count({
    where: inScope(lineScope(context), { isActive: true }),
  });
  const customers = await tx.customer.count({
    where: inScope(customerScope(context), { deletedAt: null }),
  });
  const anySector = await tx.sector.findFirst({
    where: inScope(sectorScope(context)),
    select: { id: true },
  });
  const anyLine = await tx.line.findFirst({
    where: inScope(lineScope(context)),
    select: { id: true },
  });
  return {
    sectors,
    lines,
    customers,
    setupNeeded: anySector === null || anyLine === null,
  };
}

/**
 * The sectors a comparison lists (US-081), by code: every active one, and an
 * inactive one that still has lines — its customers and money are there.
 */
export function readComparedSectors(tx: Tx, context: RequestContext) {
  return tx.sector.findMany({
    where: inScope(sectorScope(context), {
      OR: [{ isActive: true }, { lines: { some: {} } }],
    }),
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { code: 'asc' },
  });
}

/** Every line in scope, active or not, with its sector: the rollup's map. */
async function lineSectors(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, { sectorId: string; isActive: boolean }>> {
  const lines = await tx.line.findMany({
    where: inScope(lineScope(context)),
    select: { id: true, sectorId: true, isActive: true },
  });
  return new Map(lines.map((line) => [line.id, line]));
}

/**
 * Customers not deleted, per their **current** line (§23 rolls a customer up
 * through their line). Lines with none are absent.
 */
export async function readCustomersByLine(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, number>> {
  const customers = await tx.customer.groupBy({
    by: ['lineId'],
    where: inScope(customerScope(context), { deletedAt: null }),
    _count: { _all: true },
  });
  return new Map(customers.map((row) => [row.lineId, row._count._all]));
}

/**
 * §18 per sector, now: active lines, and customers not deleted on any of its
 * lines — the sector of the customer's **current** line. Summed, these are
 * `readStructure`'s lines and customers.
 */
export async function readStructureBySector(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, { lines: number; customers: number }>> {
  const lines = await lineSectors(tx, context);
  const customers = await readCustomersByLine(tx, context);
  const bySector = new Map<string, { lines: number; customers: number }>();
  const entry = (sectorId: string) => {
    const found = bySector.get(sectorId) ?? { lines: 0, customers: 0 };
    bySector.set(sectorId, found);
    return found;
  };
  for (const line of lines.values()) {
    if (line.isActive) entry(line.sectorId).lines += 1;
  }
  for (const [lineId, count] of customers) {
    const line = lines.get(lineId);
    if (line) entry(line.sectorId).customers += count;
  }
  return bySector;
}

export interface ClassificationTally {
  count: number;
  amount: Decimal;
}

/** BR-08 over a range for one line, as the collection report shows it (US-086). */
export interface ClassificationBreakdown {
  recorded: number;
  amount: Decimal;
  correct: ClassificationTally;
  low: ClassificationTally;
  extra: ClassificationTally;
  noPayment: ClassificationTally;
  adjusted: ClassificationTally;
}

/** Which entries the collection report counts, beyond the line and the range. */
export interface CollectionEntryFilters {
  /** One collector, by user id — who recorded it, not who is on the line now. */
  collectedByUserId?: string;
  /** One of BR-08's four classes. */
  classification?: 'CORRECT' | 'LOW' | 'EXTRA' | 'NO_PAYMENT';
}

const noTally = (): ClassificationTally => ({ count: 0, amount: ZERO() });

const emptyBreakdown = (): ClassificationBreakdown => ({
  recorded: 0,
  amount: ZERO(),
  correct: noTally(),
  low: noTally(),
  extra: noTally(),
  noPayment: noTally(),
  adjusted: noTally(),
});

const CLASSIFICATION_KEY = {
  CORRECT: 'correct',
  LOW: 'low',
  EXTRA: 'extra',
  NO_PAYMENT: 'noPayment',
} as const;

/**
 * BR-08's classes over a date range, per line (M12, US-086). Entries are the
 * CONFIRMED collections attributed to the line by `collection.lineId`, frozen
 * at write (BR-15), on business dates between `from` and `to` — the same rows
 * and the same predicate `lineRangeFigures` sums for `collected`, so with no
 * filter the four classes and the adjustments add up to it exactly.
 *
 * Each visit is counted once, under the classification written with it: BR-08
 * is computed at write time against that day's expected amount and is never
 * re-derived later. An approved correction (US-044) is an ADJUSTMENT row, not
 * a visit, so it is kept in `adjusted` with its signed difference.
 *
 * The caller has already scoped `lineIds` (M02); lines with nothing are
 * returned with zeros.
 */
export async function readClassificationByLine(
  tx: Tx,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
  filters: CollectionEntryFilters = {},
): Promise<Map<string, ClassificationBreakdown>> {
  const byLine = new Map<string, ClassificationBreakdown>(
    lineIds.map((lineId) => [lineId, emptyBreakdown()]),
  );
  if (lineIds.length === 0) return byLine;

  const rows = await tx.collection.groupBy({
    by: ['lineId', 'entryType', 'classification'],
    where: {
      lineId: { in: [...lineIds] },
      businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
      status: 'CONFIRMED',
      ...(filters.collectedByUserId === undefined
        ? {}
        : { collectedByUserId: filters.collectedByUserId }),
      ...(filters.classification === undefined
        ? {}
        : { classification: filters.classification }),
    },
    _count: { _all: true },
    _sum: { amount: true },
  });

  for (const row of rows) {
    const line = byLine.get(row.lineId);
    if (!line) continue;
    const amount = toMoney((row._sum.amount ?? 0).toString());
    const tally =
      row.entryType === 'ADJUSTMENT'
        ? line.adjusted
        : line[CLASSIFICATION_KEY[row.classification]];
    tally.count += row._count._all;
    tally.amount = tally.amount.plus(amount);
    if (row.entryType === 'ORIGINAL') {
      line.recorded += row._count._all;
      line.amount = line.amount.plus(amount);
    }
  }
  return byLine;
}

export interface AccountCounts {
  /** Every account, in any state — `readAccountCounts`' `total`. */
  total: number;
  active: number;
  completed: number;
}

/**
 * `readAccountCounts` per line: each account on its customer's **current**
 * line (`accountScope`). Summed, the lines are the business counts.
 */
export async function readAccountCountsByLine(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, AccountCounts>> {
  const accounts = await tx.accountLoan.findMany({
    where: inScope(accountScope(context)),
    select: { status: true, customer: { select: { lineId: true } } },
  });
  const byLine = new Map<string, AccountCounts>();
  for (const account of accounts) {
    const lineId = account.customer.lineId;
    const counts = byLine.get(lineId) ?? { total: 0, active: 0, completed: 0 };
    counts.total += 1;
    if (account.status === 'ACTIVE') counts.active += 1;
    if (account.status === 'COMPLETED') counts.completed += 1;
    byLine.set(lineId, counts);
  }
  return byLine;
}

export type DisbursedTotals = Awaited<ReturnType<typeof readDisbursedTotals>>;
type DisbursedSums = {
  accountAmount: Decimal;
  invested: Decimal;
  profit: Decimal;
};

const noDisbursement = (): DisbursedSums => ({
  accountAmount: ZERO(),
  invested: ZERO(),
  profit: ZERO(),
});

function disbursedStrings(sum: DisbursedSums): DisbursedTotals {
  return {
    accountAmount: sum.accountAmount.toFixed(2),
    invested: sum.invested.toFixed(2),
    profit: sum.profit.toFixed(2),
  };
}

/** One account's terms as the ledger recorded them, with the line holding it now. */
export interface DisbursedAccount extends DisbursedSums {
  accountLoanId: string;
  /** The customer's **current** line (`accountScope`). */
  lineId: string;
}

/**
 * Every disbursed account's `A`, `I` and `P` **from the ledger** (BR-18): each
 * DISBURSEMENT posting is the account's (`sourceTable = account_loan`), and
 * the account belongs to its customer's **current** line, as the account
 * counts do (`accountScope`). Accounts never disbursed are absent, as are
 * accounts outside the caller's scope (M02).
 *
 * The per-line and per-sector totals, and the investment report's position,
 * all fold from this one read, so they cannot drift apart.
 */
export async function readDisbursedByAccount(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, DisbursedAccount>> {
  const accounts = await tx.accountLoan.findMany({
    where: inScope(accountScope(context)),
    select: { id: true, customer: { select: { lineId: true } } },
  });
  const lineOf = new Map(
    accounts.map((account) => [account.id, account.customer.lineId]),
  );

  const postings = await tx.ledgerEntry.findMany({
    where: {
      ledgerAccount: { organizationId: context.organizationId },
      ledgerTransaction: {
        transactionType: 'DISBURSEMENT',
        sourceTable: 'account_loan',
      },
      OR: [
        {
          direction: 'DEBIT',
          ledgerAccount: { accountType: 'LOAN_RECEIVABLE' },
        },
        {
          direction: 'CREDIT',
          ledgerAccount: {
            accountType: { in: ['CASH_AT_OFFICE', 'UNEARNED_PROFIT'] },
          },
        },
      ],
    },
    select: {
      amount: true,
      ledgerAccount: { select: { accountType: true } },
      ledgerTransaction: { select: { sourceId: true } },
    },
  });

  const byAccount = new Map<string, DisbursedAccount>();
  for (const posting of postings) {
    const accountLoanId = posting.ledgerTransaction.sourceId;
    // An account outside the caller's scope is not theirs to sum (M02).
    const lineId = lineOf.get(accountLoanId);
    if (lineId === undefined) continue;
    const sum =
      byAccount.get(accountLoanId) ??
      ({ accountLoanId, lineId, ...noDisbursement() } as DisbursedAccount);
    const amount = posting.amount.toString();
    switch (posting.ledgerAccount.accountType) {
      case 'LOAN_RECEIVABLE':
        sum.accountAmount = sum.accountAmount.plus(amount);
        break;
      case 'CASH_AT_OFFICE':
        sum.invested = sum.invested.plus(amount);
        break;
      case 'UNEARNED_PROFIT':
        sum.profit = sum.profit.plus(amount);
        break;
    }
    byAccount.set(accountLoanId, sum);
  }
  return byAccount;
}

/**
 * `readDisbursedTotals` per line (§14, BR-18), folded from
 * {@link readDisbursedByAccount}. Summed, the lines are the business totals to
 * the paisa. Lines whose accounts were never disbursed are absent.
 */
export async function readDisbursedTotalsByLine(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, DisbursedTotals>> {
  const byAccount = await readDisbursedByAccount(tx, context);
  const sums = new Map<string, DisbursedSums>();
  for (const account of byAccount.values()) {
    const sum = sums.get(account.lineId) ?? noDisbursement();
    sum.accountAmount = sum.accountAmount.plus(account.accountAmount);
    sum.invested = sum.invested.plus(account.invested);
    sum.profit = sum.profit.plus(account.profit);
    sums.set(account.lineId, sum);
  }
  return new Map(
    [...sums].map(([lineId, sum]) => [lineId, disbursedStrings(sum)]),
  );
}

/** One line's investment, contracted and actual, as of now (§22, US-085). */
export interface InvestmentPosition extends DisbursedSums {
  /** Accounts disbursed, in any state. */
  accounts: number;
  /** Σ the receivables' balances: money still out. */
  outstanding: Decimal;
  /** `accountAmount − outstanding`: money returned. */
  returned: Decimal;
  /** BR-18's `round(collected × P / A)`, per account, summed. */
  profitEarned: Decimal;
  /** `profit − profitEarned`: what `UNEARNED_PROFIT` still holds for the line. */
  profitToEarn: Decimal;
}

/**
 * §22 per line, **from the ledger only** (M12): the contracted `A`, `I` and
 * `P` of {@link readDisbursedByAccount}, and against them the actual position
 * — each account's `LOAN_RECEIVABLE` balance is what is still out, `A −`
 * that balance is what came back, and the profit on it is BR-18's
 * `round(collected × P / A)` **taken per account on the running total**, which
 * is exactly the figure the account's COLLECTION and ADJUSTMENT postings have
 * moved into `EARNED_PROFIT` (the deltas telescope). Summing rounded per-line
 * or per-business figures instead would drift by a paisa an account.
 *
 * The receivable balance is the cache the nightly reconciliation rebuilds from
 * the entries and compares with each account's own collected figure (US-095),
 * so it is the ledger's number, not the account row's.
 *
 * Lines whose accounts were never disbursed are absent.
 */
export async function readInvestmentByLine(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, InvestmentPosition>> {
  const byAccount = await readDisbursedByAccount(tx, context);
  const receivables = await tx.ledgerAccount.findMany({
    where: {
      organizationId: context.organizationId,
      accountType: 'LOAN_RECEIVABLE',
    },
    select: { accountLoanId: true, balance: true },
  });
  const outstandingOf = new Map(
    receivables.flatMap((receivable) =>
      receivable.accountLoanId === null
        ? []
        : [[receivable.accountLoanId, toMoney(receivable.balance.toString())]],
    ),
  );

  const byLine = new Map<string, InvestmentPosition>();
  for (const account of byAccount.values()) {
    const position =
      byLine.get(account.lineId) ??
      ({
        accounts: 0,
        ...noDisbursement(),
        outstanding: ZERO(),
        returned: ZERO(),
        profitEarned: ZERO(),
        profitToEarn: ZERO(),
      } satisfies InvestmentPosition);
    // A disbursed account always has a receivable; a missing one is fully out.
    const outstanding = clamp(
      outstandingOf.get(account.accountLoanId) ?? account.accountAmount,
      account.accountAmount,
    );
    const returned = account.accountAmount.minus(outstanding);
    const earned = account.profit.isZero()
      ? ZERO()
      : recognisedProfit({
          accountAmount: account.accountAmount,
          profitAmount: account.profit,
          collected: returned,
        });
    position.accounts += 1;
    position.accountAmount = position.accountAmount.plus(account.accountAmount);
    position.invested = position.invested.plus(account.invested);
    position.profit = position.profit.plus(account.profit);
    position.outstanding = position.outstanding.plus(outstanding);
    position.returned = position.returned.plus(returned);
    position.profitEarned = position.profitEarned.plus(earned);
    position.profitToEarn = position.profitToEarn.plus(
      account.profit.minus(earned),
    );
    byLine.set(account.lineId, position);
  }
  return byLine;
}

/**
 * A receivable balance outside `0 … A` would mean the ledger and the account
 * disagree, which the nightly reconciliation reports (US-095). The report
 * shows the nearest position it can rather than refusing the whole figure.
 */
function clamp(outstanding: Decimal, accountAmount: Decimal): Decimal {
  if (outstanding.isNegative()) return ZERO();
  return outstanding.greaterThan(accountAmount) ? accountAmount : outstanding;
}

/** One line's ledger movement over a date range (§22, US-085). */
export interface InvestmentMovement extends DisbursedSums {
  /** Accounts disbursed in the range. */
  disbursements: number;
  /** Receivable credits less debits from COLLECTION and ADJUSTMENT postings. */
  returned: Decimal;
  /** `EARNED_PROFIT` credits less debits: BR-18's deltas, summed. */
  profitEarned: Decimal;
}

const noMovement = (): InvestmentMovement => ({
  disbursements: 0,
  ...noDisbursement(),
  returned: ZERO(),
  profitEarned: ZERO(),
});

/**
 * What the ledger recorded for each line **between `from` and `to`** by
 * posting date (US-085): the capital deployed in the period, and against it
 * the money returned and the profit recognised (BR-18's own deltas, which is
 * why they are read rather than recomputed).
 *
 * Every DISBURSEMENT, COLLECTION and ADJUSTMENT posting carries exactly one
 * `LOAN_RECEIVABLE` entry, and that receivable names the account — so a
 * transaction lands on the line holding that account now, the same attribution
 * as the position's, whichever staff member or business-wide account the other
 * side of it touched. (A WRITE_OFF is not posted anywhere yet, M09.)
 *
 * `lineIds` is already scoped (M02); a line with no posting in the range comes
 * back at zero, and the accounts are filtered by `accountScope` again here.
 */
export async function readInvestmentMovementByLine(
  tx: Tx,
  context: RequestContext,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
): Promise<Map<string, InvestmentMovement>> {
  const movement = new Map<string, InvestmentMovement>(
    lineIds.map((lineId) => [lineId, noMovement()]),
  );
  if (lineIds.length === 0) return movement;

  const accounts = await tx.accountLoan.findMany({
    where: inScope(accountScope(context)),
    select: { id: true, customer: { select: { lineId: true } } },
  });
  const lineOf = new Map(
    accounts.map((account) => [account.id, account.customer.lineId]),
  );

  const entries = await tx.ledgerEntry.findMany({
    where: {
      ledgerAccount: {
        organizationId: context.organizationId,
        accountType: {
          in: [
            'LOAN_RECEIVABLE',
            'CASH_AT_OFFICE',
            'UNEARNED_PROFIT',
            'EARNED_PROFIT',
          ],
        },
      },
      ledgerTransaction: {
        transactionType: { in: ['DISBURSEMENT', 'COLLECTION', 'ADJUSTMENT'] },
        businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
      },
    },
    select: {
      amount: true,
      direction: true,
      ledgerAccount: { select: { accountType: true, accountLoanId: true } },
      ledgerTransaction: {
        select: { id: true, transactionType: true },
      },
    },
  });

  // Each transaction's account, taken from the receivable it touched.
  const accountOf = new Map<string, string>();
  for (const entry of entries) {
    const { accountType, accountLoanId } = entry.ledgerAccount;
    if (accountType === 'LOAN_RECEIVABLE' && accountLoanId !== null) {
      accountOf.set(entry.ledgerTransaction.id, accountLoanId);
    }
  }
  const disbursed = new Map<string, Set<string>>();

  for (const entry of entries) {
    const accountLoanId = accountOf.get(entry.ledgerTransaction.id);
    if (accountLoanId === undefined) continue;
    const lineId = lineOf.get(accountLoanId);
    const sum = lineId === undefined ? undefined : movement.get(lineId);
    if (lineId === undefined || sum === undefined) continue;
    const amount = toMoney(entry.amount.toString());
    const { accountType } = entry.ledgerAccount;
    const debit = entry.direction === 'DEBIT';

    if (entry.ledgerTransaction.transactionType === 'DISBURSEMENT') {
      if (accountType === 'LOAN_RECEIVABLE' && debit) {
        sum.accountAmount = sum.accountAmount.plus(amount);
        const seen = disbursed.get(lineId) ?? new Set<string>();
        seen.add(accountLoanId);
        disbursed.set(lineId, seen);
        sum.disbursements = seen.size;
      }
      if (accountType === 'CASH_AT_OFFICE' && !debit) {
        sum.invested = sum.invested.plus(amount);
      }
      if (accountType === 'UNEARNED_PROFIT' && !debit) {
        sum.profit = sum.profit.plus(amount);
      }
      continue;
    }
    // A collection or an approved correction: the receivable falls by what
    // came back, and EARNED_PROFIT rises by the profit on it (BR-18).
    if (accountType === 'LOAN_RECEIVABLE') {
      sum.returned = debit
        ? sum.returned.minus(amount)
        : sum.returned.plus(amount);
    }
    if (accountType === 'EARNED_PROFIT') {
      sum.profitEarned = debit
        ? sum.profitEarned.minus(amount)
        : sum.profitEarned.plus(amount);
    }
  }
  return movement;
}

/**
 * `readDisbursedTotalsByLine` rolled up to each line's sector (§18). Summed,
 * the sectors are the business totals to the paisa.
 */
export async function readDisbursedTotalsBySector(
  tx: Tx,
  context: RequestContext,
): Promise<Map<string, DisbursedTotals>> {
  const lines = await lineSectors(tx, context);
  const byLine = await readDisbursedTotalsByLine(tx, context);
  const sums = new Map<string, DisbursedSums>();
  for (const [lineId, totals] of byLine) {
    const line = lines.get(lineId);
    if (!line) continue;
    const sum = sums.get(line.sectorId) ?? noDisbursement();
    sum.accountAmount = sum.accountAmount.plus(totals.accountAmount);
    sum.invested = sum.invested.plus(totals.invested);
    sum.profit = sum.profit.plus(totals.profit);
    sums.set(line.sectorId, sum);
  }
  return new Map(
    [...sums].map(([sectorId, sum]) => [sectorId, disbursedStrings(sum)]),
  );
}

/** What one account is behind by, and when it was last visited (US-087). */
export interface AccountArrears {
  /** Σ over its due days up to `asOf` of `max(expected − collected, 0)`. */
  amount: Decimal;
  /** How many of those days are still short. */
  unpaidDays: number;
  /** Its last recorded visit (BR-08's ORIGINAL entry), or null for none. */
  lastCollection: { businessDate: CalendarDate; amount: Decimal } | null;
}

/**
 * **BR-16's per-day pending, read per account** (M12, US-087): for every
 * schedule slot due on or before `asOf`, the part of that day's expected
 * amount that day's collections did not cover, summed.
 *
 * It is `lineRangeFigures`' `shortfall` at a finer grain and with the same
 * predicates — slots that are not CANCELLED, joined to CONFIRMED collections
 * on the **business date** the slot is due, so an approved correction (US-044)
 * moves the day it landed on. Taken per day, so a surplus on Tuesday never
 * erases Monday's shortfall.
 *
 * **Sundays and declared holidays cannot create arrears.** They carry no
 * schedule slot at all (BR-02, BR-04), and this reads slots — nothing has to
 * exclude them, and a holiday declared later shifts the tail rather than
 * leaving an unpayable day behind (BR-09).
 *
 * The caller has already scoped the accounts (M02); one with nothing due is
 * returned with zeros.
 */
export async function readArrearsByAccount(
  tx: Tx,
  accountLoanIds: readonly string[],
  asOf: CalendarDate,
): Promise<Map<string, AccountArrears>> {
  const arrears = new Map<string, AccountArrears>(
    accountLoanIds.map((id) => [
      id,
      { amount: ZERO(), unpaidDays: 0, lastCollection: null },
    ]),
  );
  if (accountLoanIds.length === 0) return arrears;
  const day = toUtcMidnight(asOf);
  const ids = [...accountLoanIds];

  const due = await tx.$queryRaw<
    { accountLoanId: string; arrears: string; unpaidDays: number }[]
  >`
    SELECT s."accountLoanId" AS "accountLoanId",
           COALESCE(SUM(GREATEST(s."expectedAmount" - COALESCE(p.paid, 0), 0)), 0)::text
             AS arrears,
           (COUNT(*) FILTER (
             WHERE COALESCE(p.paid, 0) < s."expectedAmount"
           ))::int AS "unpaidDays"
    FROM account_schedule s
    LEFT JOIN (
      SELECT c."accountLoanId" AS "accountLoanId",
             c."businessDate" AS "businessDate",
             SUM(c.amount) AS paid
      FROM collection c
      WHERE c.status = 'CONFIRMED'
        AND c."accountLoanId" = ANY(${ids})
      GROUP BY c."accountLoanId", c."businessDate"
    ) p ON p."accountLoanId" = s."accountLoanId"
       AND p."businessDate" = s."dueDate"
    WHERE s."accountLoanId" = ANY(${ids})
      AND s."dueDate" <= ${day}
      AND s.status <> 'CANCELLED'
    GROUP BY s."accountLoanId"`;
  for (const row of due) {
    const account = arrears.get(row.accountLoanId);
    if (!account) continue;
    account.amount = toMoney(row.arrears);
    account.unpaidDays = row.unpaidDays;
  }

  // The latest visit per account: an ADJUSTMENT is a correction, not a visit.
  const visits = await tx.$queryRaw<
    { accountLoanId: string; businessDate: Date; amount: string }[]
  >`
    SELECT DISTINCT ON (c."accountLoanId")
           c."accountLoanId" AS "accountLoanId",
           c."businessDate" AS "businessDate",
           c.amount::text AS amount
    FROM collection c
    WHERE c."accountLoanId" = ANY(${ids})
      AND c.status = 'CONFIRMED'
      AND c."entryType" = 'ORIGINAL'
      AND c."businessDate" <= ${day}
    ORDER BY c."accountLoanId", c."businessDate" DESC, c."createdAt" DESC`;
  for (const row of visits) {
    const account = arrears.get(row.accountLoanId);
    if (!account) continue;
    account.lastCollection = {
      businessDate: fromUtcMidnight(row.businessDate),
      amount: toMoney(row.amount),
    };
  }
  return arrears;
}
