import { Injectable } from '@nestjs/common';
import type {
  DiscrepancyCash,
  DiscrepancyHandover,
  DiscrepancyReport,
  DiscrepancyRow,
  DiscrepancyShow,
  DiscrepancyState,
  DiscrepancySummary,
} from '@repo/contracts';
import { type CalendarDate, toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import {
  collectorDayKey,
  type HandoverFact,
  readCollectedByCollectorDay,
  readDayCloseStatuses,
  readHandoversByCollectorDay,
} from '../cash/line-day-figures.js';
import {
  type Decimal,
  figureOrNull,
  type Tx,
  ZERO,
} from '../dashboards/business-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ValidationError } from '../platform/errors/errors.js';
import {
  decodeCursor,
  type PageRequest,
  toPageBy,
} from '../platform/pagination.js';
import {
  refuseOutOfScopeCollector,
  refuseOutOfScopeFilters,
  type ReportFilters,
  reportLineWhere,
} from './report-filters.js';
import { reportRange } from './report-range.js';

export interface DiscrepancyReportQuery extends ReportFilters, PageRequest {
  from?: string;
  to?: string;
  collectedByUserId?: string;
  show: DiscrepancyShow;
}

type LineRow = {
  id: string;
  code: string;
  name: string;
  sector: { id: string; name: string };
};

/** One row before it becomes strings: the money stays `Decimal` throughout. */
interface Row {
  line: LineRow;
  businessDate: CalendarDate;
  userId: string;
  collectedByName: string;
  collected: Decimal;
  cash: {
    handedOver: Decimal;
    acknowledged: Decimal;
    awaiting: Decimal;
    difference: Decimal;
    state: DiscrepancyState;
    handovers: HandoverFact[];
  } | null;
  dayCloseStatus: DiscrepancyRow['dayCloseStatus'];
}

/**
 * M12 — the discrepancy report (BR-17): what each Junior collected on a line
 * and date against the cash they counted out, and what the difference was.
 *
 * **The row is one line, one business date, one Junior**, because that is the
 * unit BR-17 defines a discrepancy on: `cash declared − collections recorded`,
 * for that Junior, that date. A whole line's day is the sum of its Juniors'
 * rows and is the day close's own figure (S-05), which the report never
 * contradicts: `Σ acknowledged − Σ collected` over a line's day is exactly the
 * `discrepancy` that screen shows.
 *
 * **The sign is the answer.** `difference` is `handedOver − collected`,
 * negative when the Junior is short and positive when they handed over more
 * than Rasi recorded, and it is never reduced to an absolute value. The
 * summary keeps `short` and `over` apart as well as their `net`, so a ₹200
 * shortage on one line and a ₹200 surplus on another can never read as a clean
 * book.
 *
 * **Every figure is per line, per day, per Junior, then summed** — a range is
 * exactly the sum of its days, as BR-16 requires of the other reports.
 *
 * Scope comes first (M02): the lines are `lineScope`'s, so a Senior's rows are
 * their own line's, and a sector, line or staff member outside it is `404`, as
 * a missing one is. The handovers and the day closes are read as their own
 * groups (S-07): one that fails is `null` on every row and in the summary,
 * never `0`.
 */
@Injectable()
export class DiscrepancyReportService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    query: DiscrepancyReportQuery,
    now: Date = new Date(),
  ): Promise<DiscrepancyReport> {
    const { from, to } = reportRange(query, now);
    const tx = this.database.client;
    await refuseOutOfScopeFilters(tx, context, query);
    await refuseOutOfScopeCollector(
      tx,
      context,
      query.collectedByUserId,
      toBusinessDate(now),
    );

    const lines = await tx.line.findMany({
      where: reportLineWhere(context, query),
      select: {
        id: true,
        code: true,
        name: true,
        sector: { select: { id: true, name: true } },
      },
    });
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const lineIds = [...lineById.keys()];

    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);
    const collected = await readCollectedByCollectorDay(tx, lineIds, from, to, {
      collectedByUserId: query.collectedByUserId,
    });
    const handovers = await figure('handovers', () =>
      readHandoversByCollectorDay(tx, lineIds, from, to, {
        collectedByUserId: query.collectedByUserId,
      }),
    );
    const statuses = await figure('dayCloses', () =>
      readDayCloseStatuses(tx, lineIds, from, to),
    );
    const names = await this.names(tx, [
      ...collected.map((row) => row.userId),
      ...[...(handovers?.values() ?? [])].flatMap((facts) =>
        facts.map((fact) => fact.toUserId),
      ),
    ]);

    const rows = collected
      .map((row): Row => {
        const line = lineById.get(row.lineId)!;
        const key = collectorDayKey(row.lineId, row.businessDate, row.userId);
        return {
          line,
          businessDate: row.businessDate,
          userId: row.userId,
          collectedByName: names.get(row.userId) ?? 'Unknown staff',
          collected: row.collected,
          cash:
            handovers === null
              ? null
              : cashOf(row.collected, handovers.get(key) ?? []),
          dayCloseStatus:
            statuses === null
              ? null
              : (statuses.get(`${row.lineId}|${row.businessDate}`) ?? 'OPEN'),
        };
      })
      // The handovers a row is judged against are unknown, so nothing can be
      // called settled: every row is listed rather than silently filtered out.
      .filter(
        (row) =>
          query.show === 'all' ||
          row.cash === null ||
          row.cash.state !== 'TALLIED',
      )
      .sort(order);

    const page = toPageBy(
      after(rows, query),
      query,
      (row) => collectorDayKey(row.line.id, row.businessDate, row.userId),
      (row) => toRow(row, names),
    );
    return {
      ...page,
      from,
      to,
      generatedAt: now.toISOString(),
      summary: summaryOf(rows, handovers !== null),
    };
  }

  private async names(tx: Tx, userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map<string, string>();
    const users = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

/**
 * Newest day first, then by line code and the Junior's name — the order an
 * investigation reads in. The line and the collector settle every tie, so the
 * order is total and a page boundary can neither repeat nor drop a row.
 */
function order(a: Row, b: Row): number {
  if (a.businessDate !== b.businessDate) {
    return a.businessDate < b.businessDate ? 1 : -1;
  }
  return (
    a.line.code.localeCompare(b.line.code) ||
    a.collectedByName.localeCompare(b.collectedByName) ||
    a.line.id.localeCompare(b.line.id) ||
    a.userId.localeCompare(b.userId)
  );
}

/**
 * The rows after the cursor, in the order above. The whole range is computed
 * before it is paged — it is bounded by `MAX_REPORT_DAYS` and the lines in
 * scope — so the cursor names a row rather than an offset, and a row that
 * arrives while someone is paging cannot shift the page under them. A cursor
 * naming no row is refused, never silently treated as the first page.
 */
function after(rows: Row[], page: PageRequest): Row[] {
  if (page.cursor === undefined) return rows.slice(0, page.limit + 1);
  const key = decodeCursor(page.cursor);
  const at = rows.findIndex(
    (row) => collectorDayKey(row.line.id, row.businessDate, row.userId) === key,
  );
  if (at === -1) {
    throw new ValidationError(
      'INVALID_CURSOR',
      'The page cursor is not valid',
      [{ field: 'cursor', issue: 'is not a cursor this API issued' }],
    );
  }
  return rows.slice(at + 1, at + 1 + page.limit + 1);
}

/**
 * BR-17 for one Junior's line-day. A **disputed** handover is listed but in no
 * amount: disputed cash never moved (US-063) and the sender counts again.
 *
 * The state, in the order it is decided:
 *
 * - `DISPUTED` — an argument is open, whatever the amounts say.
 * - `SHORT` / `OVER` — cash was counted and it does not match.
 * - `AWAITING` — nothing counted yet, or a count still waiting on its
 *   acknowledgement. Not a discrepancy: cash still on its way is not cash
 *   missing, and calling it short would accuse a Junior at four in the
 *   afternoon.
 * - `TALLIED` — every rupee recorded was counted and acknowledged.
 */
function cashOf(collected: Decimal, handovers: HandoverFact[]) {
  const sum = (of: (row: HandoverFact) => boolean) =>
    handovers
      .filter(of)
      .reduce((total: Decimal, row) => total.plus(row.declared), ZERO());
  const acknowledged = sum((row) => row.status === 'ACKNOWLEDGED');
  const awaiting = sum((row) => row.status === 'PENDING');
  const handedOver = acknowledged.plus(awaiting);
  const difference = handedOver.minus(collected);
  const counted = handovers.some((row) => row.status !== 'DISPUTED');
  return {
    handedOver,
    acknowledged,
    awaiting,
    difference,
    state: stateOf(handovers, difference, counted, awaiting),
    handovers,
  };
}

function stateOf(
  handovers: HandoverFact[],
  difference: Decimal,
  counted: boolean,
  awaiting: Decimal,
): DiscrepancyState {
  if (handovers.some((row) => row.status === 'DISPUTED')) return 'DISPUTED';
  if (!difference.isZero()) {
    // Nothing counted out yet: the cash is still with the Junior, which is not
    // the same as missing, however large the gap looks at four in the afternoon.
    if (!counted) return 'AWAITING';
    return difference.isNegative() ? 'SHORT' : 'OVER';
  }
  return awaiting.isZero() ? 'TALLIED' : 'AWAITING';
}

function toRow(row: Row, names: Map<string, string>): DiscrepancyRow {
  return {
    businessDate: row.businessDate,
    lineId: row.line.id,
    lineCode: row.line.code,
    lineName: row.line.name,
    sectorId: row.line.sector.id,
    sectorName: row.line.sector.name,
    collectedByUserId: row.userId,
    collectedByName: row.collectedByName,
    collected: row.collected.toFixed(2),
    cash: row.cash === null ? null : cashStrings(row.cash, names),
    dayCloseStatus: row.dayCloseStatus,
  };
}

function cashStrings(
  cash: NonNullable<Row['cash']>,
  names: Map<string, string>,
): DiscrepancyCash {
  return {
    handedOver: cash.handedOver.toFixed(2),
    acknowledged: cash.acknowledged.toFixed(2),
    awaiting: cash.awaiting.toFixed(2),
    difference: cash.difference.toFixed(2),
    state: cash.state,
    handovers: cash.handovers.map((row): DiscrepancyHandover => ({
      handoverId: row.id,
      status: row.status,
      toUserId: row.toUserId,
      toName: names.get(row.toUserId) ?? 'Unknown staff',
      declared: row.declared.toFixed(2),
      recorded: row.recorded.toFixed(2),
      difference: row.difference.toFixed(2),
      note: row.note,
      disputeNote: row.disputeNote,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * The whole matching set, not the page, so paging never changes a total —
 * every row in the range is already computed. `short` and `over` stay apart:
 * summing the signed differences alone would let one line's shortage hide
 * another's surplus, which is the mistake BR-16 forbids a day at a time.
 */
function summaryOf(rows: Row[], cashKnown: boolean): DiscrepancySummary {
  const collected = rows.reduce(
    (total: Decimal, row) => total.plus(row.collected),
    ZERO(),
  );
  const sum = (pick: (cash: NonNullable<Row['cash']>) => Decimal) =>
    rows.reduce(
      (total: Decimal, row) => (row.cash ? total.plus(pick(row.cash)) : total),
      ZERO(),
    );
  const short = sum((cash) =>
    cash.difference.isNegative() ? cash.difference.negated() : ZERO(),
  );
  const over = sum((cash) =>
    cash.difference.greaterThan(0) ? cash.difference : ZERO(),
  );
  return {
    rows: rows.length,
    lines: new Set(rows.map((row) => row.line.id)).size,
    days: new Set(rows.map((row) => row.businessDate)).size,
    collected: collected.toFixed(2),
    cash: cashKnown
      ? {
          handedOver: sum((cash) => cash.handedOver).toFixed(2),
          acknowledged: sum((cash) => cash.acknowledged).toFixed(2),
          awaiting: sum((cash) => cash.awaiting).toFixed(2),
          short: short.toFixed(2),
          over: over.toFixed(2),
          net: over.minus(short).toFixed(2),
          unresolved: rows.filter((row) => row.cash?.state !== 'TALLIED')
            .length,
        }
      : null,
  };
}
