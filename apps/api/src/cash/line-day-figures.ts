import type { DayCloseStatus, HandoverStatus, Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

type Tx = Prisma.TransactionClient;
type Decimal = ReturnType<typeof toMoney>;

export interface LineDayFigures {
  /** Σ expected of the line's slots due that date, cancelled ones excepted (BR-16). */
  expected: Decimal;
  /** Σ confirmed collections attributed to the line that date (BR-15), adjustments included. */
  collected: Decimal;
  /** Σ acknowledged Junior → Senior handovers for the line's day. */
  cashReceived: Decimal;
  /** Slots due that date on active or completed accounts, marked MISSED at close. */
  missed: number;
}

/**
 * BR-16's figures for several lines' days in one pass — the single definition
 * S-05 (day close) and S-20 (the Admin dashboard) both read, so the two can
 * never show different totals for the same line and date.
 *
 * - **Expected** follows the slot's account to its customer's **current**
 *   line, as the day close always has: a line collects its customers' slots.
 * - **Collected** is by `collection.lineId`, frozen at write (BR-15).
 *
 * The caller has already scoped `lineIds` (M02); lines with nothing due are
 * returned with zeros.
 */
export async function lineDayFigures(
  tx: Tx,
  lineIds: readonly string[],
  businessDate: CalendarDate,
): Promise<Map<string, LineDayFigures>> {
  const figures = new Map<string, LineDayFigures>(
    lineIds.map((lineId) => [
      lineId,
      {
        expected: toMoney('0'),
        collected: toMoney('0'),
        cashReceived: toMoney('0'),
        missed: 0,
      },
    ]),
  );
  if (lineIds.length === 0) return figures;
  const day = toUtcMidnight(businessDate);
  const ids = [...lineIds];

  const slots = await tx.$queryRaw<
    { lineId: string; expected: string; missed: number }[]
  >`
    SELECT c."lineId" AS "lineId",
           COALESCE(SUM(s."expectedAmount"), 0)::text AS expected,
           (COUNT(*) FILTER (
             WHERE s.status = 'MISSED' AND a.status IN ('ACTIVE', 'COMPLETED')
           ))::int AS missed
    FROM account_schedule s
    JOIN account_loan a ON a.id = s."accountLoanId"
    JOIN customer c ON c.id = a."customerId"
    WHERE s."dueDate" = ${day}
      AND s.status <> 'CANCELLED'
      AND c."lineId" = ANY(${ids})
    GROUP BY c."lineId"`;
  for (const row of slots) {
    const line = figures.get(row.lineId);
    if (!line) continue;
    line.expected = toMoney(row.expected);
    line.missed = row.missed;
  }

  const collected = await tx.collection.groupBy({
    by: ['lineId'],
    where: { lineId: { in: ids }, businessDate: day, status: 'CONFIRMED' },
    _sum: { amount: true },
  });
  for (const row of collected) {
    const line = figures.get(row.lineId);
    if (line) line.collected = toMoney((row._sum.amount ?? 0).toString());
  }

  const received = await tx.cashHandover.findMany({
    where: {
      dayClose: { lineId: { in: ids }, businessDate: day },
      hop: 'JUNIOR_TO_SENIOR',
      status: 'ACKNOWLEDGED',
    },
    select: { declaredAmount: true, dayClose: { select: { lineId: true } } },
  });
  for (const row of received) {
    const line = figures.get(row.dayClose.lineId);
    if (line) {
      line.cashReceived = line.cashReceived.plus(row.declaredAmount.toString());
    }
  }
  return figures;
}

export interface LineRangeFigures {
  /** Σ over the range of each day's expected (BR-16). */
  expected: Decimal;
  /** Σ over the range of each day's collected (BR-15), adjustments included. */
  collected: Decimal;
  /** Σ over the days of expected − collected where that day's is positive. */
  shortfall: Decimal;
  /** Σ over the days of collected − expected where that day's is positive. */
  surplus: Decimal;
  /**
   * Slots due in the range on active or completed accounts that the day close
   * marked MISSED — a visit that never happened (BR-09), summed over the days
   * exactly as {@link lineDayFigures} counts one.
   */
  missed: number;
}

/**
 * {@link lineDayFigures}' expected and collected for every day from `from` to
 * `to` inclusive, read in one pass with the **same predicates**, and BR-16
 * taken per line **per day** before summing — so a range is exactly the sum
 * of its days, and a surplus on one day never hides a shortfall on another
 * (M12, US-084).
 *
 * The caller has already scoped `lineIds` (M02); lines with nothing in the
 * range are returned with zeros.
 */
export async function lineRangeFigures(
  tx: Tx,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
): Promise<Map<string, LineRangeFigures>> {
  const figures = new Map<string, LineRangeFigures>(
    lineIds.map((lineId) => [
      lineId,
      {
        expected: toMoney('0'),
        collected: toMoney('0'),
        shortfall: toMoney('0'),
        surplus: toMoney('0'),
        missed: 0,
      },
    ]),
  );
  if (lineIds.length === 0) return figures;
  const first = toUtcMidnight(from);
  const last = toUtcMidnight(to);
  const ids = [...lineIds];

  // Each (line, day) pair's expected and collected, keyed "lineId|YYYY-MM-DD".
  const days = new Map<string, { expected: Decimal; collected: Decimal }>();
  const day = (lineId: string, date: Date) => {
    const key = `${lineId}|${fromUtcMidnight(date)}`;
    const found = days.get(key) ?? {
      expected: toMoney('0'),
      collected: toMoney('0'),
    };
    days.set(key, found);
    return found;
  };

  const slots = await tx.$queryRaw<
    { lineId: string; dueDate: Date; expected: string; missed: number }[]
  >`
    SELECT c."lineId" AS "lineId",
           s."dueDate" AS "dueDate",
           COALESCE(SUM(s."expectedAmount"), 0)::text AS expected,
           (COUNT(*) FILTER (
             WHERE s.status = 'MISSED' AND a.status IN ('ACTIVE', 'COMPLETED')
           ))::int AS missed
    FROM account_schedule s
    JOIN account_loan a ON a.id = s."accountLoanId"
    JOIN customer c ON c.id = a."customerId"
    WHERE s."dueDate" BETWEEN ${first} AND ${last}
      AND s.status <> 'CANCELLED'
      AND c."lineId" = ANY(${ids})
    GROUP BY c."lineId", s."dueDate"`;
  for (const row of slots) {
    day(row.lineId, row.dueDate).expected = toMoney(row.expected);
    const line = figures.get(row.lineId);
    if (line) line.missed += row.missed;
  }

  const collected = await tx.collection.groupBy({
    by: ['lineId', 'businessDate'],
    where: {
      lineId: { in: ids },
      businessDate: { gte: first, lte: last },
      status: 'CONFIRMED',
    },
    _sum: { amount: true },
  });
  for (const row of collected) {
    day(row.lineId, row.businessDate).collected = toMoney(
      (row._sum.amount ?? 0).toString(),
    );
  }

  for (const [key, money] of days) {
    const line = figures.get(key.slice(0, key.indexOf('|')));
    if (!line) continue;
    line.expected = line.expected.plus(money.expected);
    line.collected = line.collected.plus(money.collected);
    // BR-16, per day: a shortfall when expected exceeds collected, a surplus when collected exceeds it.
    const gap = money.expected.minus(money.collected);
    if (gap.greaterThan(0)) line.shortfall = line.shortfall.plus(gap);
    if (gap.lessThan(0)) line.surplus = line.surplus.minus(gap);
  }
  return figures;
}

/**
 * One line, one business date, one collector — the unit BR-17 defines a cash
 * discrepancy on ("cash declared − collections recorded, for that Junior, that
 * date"). The key is `lineId|YYYY-MM-DD|userId`.
 */
export const collectorDayKey = (
  lineId: string,
  businessDate: CalendarDate,
  userId: string,
) => `${lineId}|${businessDate}|${userId}`;

/** The three parts of a {@link collectorDayKey}, in order. */
export function readCollectorDayKey(key: string): {
  lineId: string;
  businessDate: CalendarDate;
  userId: string;
} {
  const [lineId = '', businessDate = '', userId = ''] = key.split('|');
  return { lineId, businessDate: businessDate as CalendarDate, userId };
}

/** What one Junior collected on one line and date (BR-15), corrections included. */
export interface CollectorDayCollected {
  lineId: string;
  businessDate: CalendarDate;
  userId: string;
  collected: Decimal;
}

/**
 * Σ each collector's CONFIRMED collections per line and business date over a
 * range — `lineDayFigures`' `collected` at a finer grain and with the same
 * predicates, so the collectors of one line-day add up to that line-day's
 * collected exactly (M12, the discrepancy report).
 *
 * Approved corrections (US-044) are ADJUSTMENT rows carrying the original's
 * line and collector on the date they were approved (BR-14), so they move the
 * collector's figure on that date, as every other figure that reads
 * collections by date does.
 *
 * The caller has already scoped `lineIds` (M02).
 */
export async function readCollectedByCollectorDay(
  tx: Tx,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
  filters: { collectedByUserId?: string | undefined } = {},
): Promise<CollectorDayCollected[]> {
  if (lineIds.length === 0) return [];
  const groups = await tx.collection.groupBy({
    by: ['lineId', 'businessDate', 'collectedByUserId'],
    where: {
      lineId: { in: [...lineIds] },
      businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
      status: 'CONFIRMED',
      ...(filters.collectedByUserId === undefined
        ? {}
        : { collectedByUserId: filters.collectedByUserId }),
    },
    _sum: { amount: true },
  });
  return groups.map((group) => ({
    lineId: group.lineId,
    businessDate: fromUtcMidnight(group.businessDate),
    userId: group.collectedByUserId,
    collected: toMoney((group._sum.amount ?? 0).toString()),
  }));
}

/** One Junior → Senior handover as the discrepancy report reads it (BR-17). */
export interface HandoverFact {
  id: string;
  status: HandoverStatus;
  toUserId: string;
  declared: Decimal;
  /** What Rasi recorded for the sender, less what earlier handovers covered. */
  recorded: Decimal;
  /** `declared − recorded`, stored at the count. */
  difference: Decimal;
  note: string | null;
  disputeNote: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

/**
 * Every Junior → Senior handover for the lines' days in a range, grouped by
 * {@link collectorDayKey} on the **sender** — the Junior who counted the cash.
 * Oldest first within a day, so a row reads in the order the counts happened.
 *
 * The office hop (Senior → office) is deliberately not here: it is a Senior's
 * aggregate of what they acknowledged, not one Junior's own cash, and BR-17's
 * formula is written per Junior per date. It stays on S-05 and `/cash`.
 */
export async function readHandoversByCollectorDay(
  tx: Tx,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
  filters: { collectedByUserId?: string | undefined } = {},
): Promise<Map<string, HandoverFact[]>> {
  const byKey = new Map<string, HandoverFact[]>();
  if (lineIds.length === 0) return byKey;
  const rows = await tx.cashHandover.findMany({
    where: {
      hop: 'JUNIOR_TO_SENIOR',
      dayClose: {
        lineId: { in: [...lineIds] },
        businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
      },
      ...(filters.collectedByUserId === undefined
        ? {}
        : { fromUserId: filters.collectedByUserId }),
    },
    select: {
      id: true,
      status: true,
      fromUserId: true,
      toUserId: true,
      declaredAmount: true,
      systemAmount: true,
      discrepancy: true,
      note: true,
      disputeNote: true,
      createdAt: true,
      acknowledgedAt: true,
      dayClose: { select: { lineId: true, businessDate: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) {
    const key = collectorDayKey(
      row.dayClose.lineId,
      fromUtcMidnight(row.dayClose.businessDate),
      row.fromUserId,
    );
    const found = byKey.get(key) ?? [];
    found.push({
      id: row.id,
      status: row.status,
      toUserId: row.toUserId,
      declared: toMoney(row.declaredAmount.toString()),
      recorded: toMoney(row.systemAmount.toString()),
      difference: toMoney(row.discrepancy.toString()),
      note: row.note,
      disputeNote: row.disputeNote,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
    });
    byKey.set(key, found);
  }
  return byKey;
}

/**
 * The `day_close` status of each line's day in a range, keyed
 * `lineId|YYYY-MM-DD`. A day with no row has never been closed and is `OPEN`,
 * which is what `DayCloseService.view` reports for it.
 */
export async function readDayCloseStatuses(
  tx: Tx,
  lineIds: readonly string[],
  from: CalendarDate,
  to: CalendarDate,
): Promise<Map<string, DayCloseStatus>> {
  const byKey = new Map<string, DayCloseStatus>();
  if (lineIds.length === 0) return byKey;
  const rows = await tx.dayClose.findMany({
    where: {
      lineId: { in: [...lineIds] },
      businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
    },
    select: { lineId: true, businessDate: true, status: true },
  });
  for (const row of rows) {
    byKey.set(`${row.lineId}|${fromUtcMidnight(row.businessDate)}`, row.status);
  }
  return byKey;
}
