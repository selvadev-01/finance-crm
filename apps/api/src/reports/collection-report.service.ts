import { Injectable } from '@nestjs/common';
import type { CollectionReport, CollectionReportRow } from '@repo/contracts';
import { toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { lineRangeFigures } from '../cash/line-day-figures.js';
import {
  type ClassificationBreakdown,
  type ClassificationTally,
  type CollectionEntryFilters,
  type Decimal,
  figureOrNull,
  readClassificationByLine,
  type Tx,
  ZERO,
} from '../dashboards/business-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  refuseOutOfScopeCollector,
  refuseOutOfScopeFilters,
  type ReportFilters,
  reportLineWhere,
} from './report-filters.js';
import { reportRange } from './report-range.js';

export interface CollectionReportQuery
  extends ReportFilters, CollectionEntryFilters {
  from?: string;
  to?: string;
}

type Totals = NonNullable<CollectionReport['totals']>;
type Comparison = NonNullable<CollectionReportRow['collections']>;
type Breakdown = NonNullable<CollectionReportRow['classification']>;

/**
 * M12 — the collection report (US-086): over a date range, what each line was
 * expected to collect against what it actually collected, and BR-08's
 * classification of every entry behind that number, with the lines totalled.
 *
 * Two groups, both from the readers the day close and the dashboards share, so
 * a report over one day equals S-05 and S-20 for that day:
 *
 * - **`collections`** — `lineRangeFigures`: expected from the slots due in the
 *   range (each on its account's customer's **current** line, as the day close
 *   reads them), collected by `collection.lineId` frozen at write (BR-15),
 *   `pending` and `extra` taken per line **per day** (BR-16) so a surplus never
 *   hides another day's shortfall, `variance` the plain difference over the
 *   whole range, and `missed` the slots the close marked MISSED (BR-09).
 * - **`classification`** — `readClassificationByLine`: BR-08's four classes as
 *   each entry was written with them, plus approved corrections apart in
 *   `adjusted`. Unfiltered, those five amounts sum to `collected` exactly.
 *
 * **The collector and classification filters narrow the entries only.** A
 * schedule slot belongs to a line and a day, not to a Junior or a class, so
 * expected, pending, extra and missed stay the line's own — the comparison is
 * BR-16's, which is defined per line per day and nothing else.
 *
 * Scope comes first (M02): a Senior's lines are their current line, and a
 * sector, line or staff member outside it is `404`, as a missing one is.
 *
 * Each group is read on its own (S-07): one that fails is `null` on every row
 * and in the totals, never `0`.
 */
@Injectable()
export class CollectionReportService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    query: CollectionReportQuery,
    now: Date = new Date(),
  ): Promise<CollectionReport> {
    const { from, to } = reportRange(query, now);
    const tx = this.database.client;
    await refuseOutOfScopeFilters(tx, context, query);
    await refuseOutOfScopeCollector(
      tx,
      context,
      query.collectedByUserId,
      toBusinessDate(now),
    );
    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);

    const listed = await figure('lines', () =>
      this.readLines(tx, context, query),
    );
    if (listed === null) {
      return {
        from,
        to,
        generatedAt: now.toISOString(),
        lines: null,
        totals: null,
      };
    }
    const ids = listed.map((line) => line.id);
    const collections = await figure('collections', () =>
      lineRangeFigures(tx, ids, from, to),
    );
    const classification = await figure('classification', () =>
      readClassificationByLine(tx, ids, from, to, {
        collectedByUserId: query.collectedByUserId,
        classification: query.classification,
      }),
    );

    const rows = listed
      // An inactive line is listed while it carried money in the range, or
      // when it was asked for by name.
      .filter((line) => {
        if (line.isActive || line.id === query.lineId) return true;
        const money = collections?.get(line.id);
        const entries = classification?.get(line.id);
        return (
          (money !== undefined &&
            !(money.expected.isZero() && money.collected.isZero())) ||
          (entries !== undefined && entries.recorded > 0)
        );
      })
      .map((line): CollectionReportRow => {
        const money = collections?.get(line.id);
        const entries = classification?.get(line.id);
        return {
          lineId: line.id,
          code: line.code,
          name: line.name,
          isActive: line.isActive,
          sectorId: line.sector.id,
          sectorCode: line.sector.code,
          sectorName: line.sector.name,
          collections:
            money === undefined
              ? null
              : {
                  expected: money.expected.toFixed(2),
                  collected: money.collected.toFixed(2),
                  variance: money.collected.minus(money.expected).toFixed(2),
                  pending: money.shortfall.toFixed(2),
                  extra: money.surplus.toFixed(2),
                  missed: money.missed,
                },
          classification:
            entries === undefined ? null : breakdownStrings(entries),
        };
      });

    return {
      from,
      to,
      generatedAt: now.toISOString(),
      lines: rows,
      totals: totalsOf(rows, {
        collections: collections !== null,
        classification: classification !== null,
      }),
    };
  }

  /** The lines in scope and filter, active or not, by code. */
  private readLines(
    tx: Tx,
    context: RequestContext,
    query: CollectionReportQuery,
  ) {
    return tx.line.findMany({
      where: reportLineWhere(context, query),
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        sector: { select: { id: true, code: true, name: true } },
      },
      orderBy: { code: 'asc' },
    });
  }
}

const tallyStrings = (tally: ClassificationTally) => ({
  count: tally.count,
  amount: tally.amount.toFixed(2),
});

function breakdownStrings(entries: ClassificationBreakdown): Breakdown {
  return {
    recorded: entries.recorded,
    amount: entries.amount.toFixed(2),
    correct: tallyStrings(entries.correct),
    low: tallyStrings(entries.low),
    extra: tallyStrings(entries.extra),
    noPayment: tallyStrings(entries.noPayment),
    adjusted: tallyStrings(entries.adjusted),
  };
}

/** The rows summed exactly; a group unknown on the rows is unknown here. */
function totalsOf(
  rows: CollectionReportRow[],
  known: { collections: boolean; classification: boolean },
): Totals {
  const sum = (pick: (row: CollectionReportRow) => string): string =>
    rows
      .reduce((total: Decimal, row) => total.plus(pick(row)), ZERO())
      .toFixed(2);
  const count = (pick: (row: CollectionReportRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  const tally = (pick: (row: Breakdown) => Breakdown['correct']) => ({
    count: count((row) => pick(row.classification!).count),
    amount: sum((row) => pick(row.classification!).amount),
  });
  const comparison = (pick: (row: Comparison) => string) =>
    sum((row) => pick(row.collections!));
  return {
    lines: rows.length,
    collections: known.collections
      ? {
          expected: comparison((money) => money.expected),
          collected: comparison((money) => money.collected),
          variance: comparison((money) => money.variance),
          pending: comparison((money) => money.pending),
          extra: comparison((money) => money.extra),
          missed: count((row) => row.collections!.missed),
        }
      : null,
    classification: known.classification
      ? {
          recorded: count((row) => row.classification!.recorded),
          amount: sum((row) => row.classification!.amount),
          correct: tally((entries) => entries.correct),
          low: tally((entries) => entries.low),
          extra: tally((entries) => entries.extra),
          noPayment: tally((entries) => entries.noPayment),
          adjusted: tally((entries) => entries.adjusted),
        }
      : null,
  };
}
