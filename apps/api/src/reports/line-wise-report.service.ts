import { Injectable } from '@nestjs/common';
import type { LineWiseReport, LineWiseRow } from '@repo/contracts';
import type { CalendarDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { assignmentInEffectOn } from '../access/scope.js';
import { lineRangeFigures } from '../cash/line-day-figures.js';
import {
  type Decimal,
  figureOrNull,
  readAccountCountsByLine,
  readCustomersByLine,
  readDisbursedTotalsByLine,
  type Tx,
  ZERO,
} from '../dashboards/business-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  refuseOutOfScopeFilters,
  type ReportFilters,
  reportLineWhere,
} from './report-filters.js';
import { reportRange } from './report-range.js';

export interface LineWiseQuery extends ReportFilters {
  from?: string;
  to?: string;
}

type Totals = NonNullable<LineWiseReport['totals']>;

/**
 * M12 — the line-wise report (US-084, PDF §14): per line, its sector, Senior
 * and Juniors, customers, accounts and completed accounts, account amount,
 * invested and profit, and expected, actual, pending and extra collection
 * over a date range, with the lines totalled.
 *
 * Every figure comes from a reader the dashboards share, so the report over
 * one day equals S-07, S-20 and US-081 for that day:
 *
 * - **Collections** — `lineRangeFigures`, the day close's own predicates
 *   (BR-16) over the range, pending and extra taken per line per day.
 * - **Customers and accounts** — each on the customer's **current** line,
 *   now (`accountScope`).
 * - **Amounts** — the ledger's DISBURSEMENT postings (BR-18), all time, for
 *   the accounts the line holds now. §14 describes the line's book, not the
 *   range's lending; the range bounds the collections.
 * - **Staff** — assigned on the range's last day.
 *
 * Scope comes first (M02): a Senior's lines are their current line, and a
 * sector or line outside it is `404`, as a missing one is. A Senior sees
 * invested and profit for that line — the matrix's "own line" cells.
 *
 * Each group is read on its own (S-07): one that fails is `null` on every
 * row and in the totals, never `0`.
 */
@Injectable()
export class LineWiseReportService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    query: LineWiseQuery,
    now: Date = new Date(),
  ): Promise<LineWiseReport> {
    const { from, to } = reportRange(query, now);
    const tx = this.database.client;
    await refuseOutOfScopeFilters(tx, context, query);
    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);

    const listed = await figure('lines', () =>
      this.readLines(tx, context, query, to),
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
    const customers = await figure('customers', () =>
      readCustomersByLine(tx, context),
    );
    const accounts = await figure('accounts', () =>
      readAccountCountsByLine(tx, context),
    );
    const amounts = await figure('amounts', () =>
      readDisbursedTotalsByLine(tx, context),
    );
    const book =
      customers === null || accounts === null ? null : { customers, accounts };

    const rows = listed
      // An inactive line is listed while it carried money in the range, or
      // when it was asked for by name.
      .filter((line) => {
        if (line.isActive || line.id === query.lineId) return true;
        const money = collections?.get(line.id);
        return (
          money !== undefined &&
          !(money.expected.isZero() && money.collected.isZero())
        );
      })
      .map((line): LineWiseRow => {
        const money = collections?.get(line.id);
        const counts = book?.accounts.get(line.id);
        return {
          lineId: line.id,
          code: line.code,
          name: line.name,
          isActive: line.isActive,
          sectorId: line.sector.id,
          sectorCode: line.sector.code,
          sectorName: line.sector.name,
          staff: {
            seniorName:
              line.assignments.find(
                (assignment) => assignment.assignmentRole === 'SENIOR',
              )?.staffProfile.user.name ?? null,
            juniorNames: line.assignments
              .filter((assignment) => assignment.assignmentRole === 'JUNIOR')
              .map((assignment) => assignment.staffProfile.user.name)
              .sort((a, b) => a.localeCompare(b)),
          },
          book:
            book === null
              ? null
              : {
                  customers: book.customers.get(line.id) ?? 0,
                  accounts: counts?.total ?? 0,
                  activeAccounts: counts?.active ?? 0,
                  completedAccounts: counts?.completed ?? 0,
                },
          amounts:
            amounts === null
              ? null
              : (amounts.get(line.id) ?? {
                  accountAmount: '0.00',
                  invested: '0.00',
                  profit: '0.00',
                }),
          collections:
            money === undefined
              ? null
              : {
                  expected: money.expected.toFixed(2),
                  collected: money.collected.toFixed(2),
                  pending: money.shortfall.toFixed(2),
                  extra: money.surplus.toFixed(2),
                },
        };
      });

    return {
      from,
      to,
      generatedAt: now.toISOString(),
      lines: rows,
      totals: totalsOf(rows, {
        book: book !== null,
        amounts: amounts !== null,
        collections: collections !== null,
      }),
    };
  }

  /** The lines in scope and filter, active or not, by code, with their staff on `onDate`. */
  private readLines(
    tx: Tx,
    context: RequestContext,
    query: LineWiseQuery,
    onDate: CalendarDate,
  ) {
    return tx.line.findMany({
      where: reportLineWhere(context, query),
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        sector: { select: { id: true, code: true, name: true } },
        assignments: {
          where: assignmentInEffectOn(onDate),
          select: {
            assignmentRole: true,
            staffProfile: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
  }
}

/** The rows summed exactly; a group unknown on the rows is unknown here. */
function totalsOf(
  rows: LineWiseRow[],
  known: { book: boolean; amounts: boolean; collections: boolean },
): Totals {
  const sum = (pick: (row: LineWiseRow) => string): string =>
    rows
      .reduce((total: Decimal, row) => total.plus(pick(row)), ZERO())
      .toFixed(2);
  const count = (pick: (row: LineWiseRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    lines: rows.length,
    book: known.book
      ? {
          customers: count((row) => row.book!.customers),
          accounts: count((row) => row.book!.accounts),
          activeAccounts: count((row) => row.book!.activeAccounts),
          completedAccounts: count((row) => row.book!.completedAccounts),
        }
      : null,
    amounts: known.amounts
      ? {
          accountAmount: sum((row) => row.amounts!.accountAmount),
          invested: sum((row) => row.amounts!.invested),
          profit: sum((row) => row.amounts!.profit),
        }
      : null,
    collections: known.collections
      ? {
          expected: sum((row) => row.collections!.expected),
          collected: sum((row) => row.collections!.collected),
          pending: sum((row) => row.collections!.pending),
          extra: sum((row) => row.collections!.extra),
        }
      : null,
  };
}
