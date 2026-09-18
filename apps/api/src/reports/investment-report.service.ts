import { Injectable } from '@nestjs/common';
import type { InvestmentReport, InvestmentRow } from '@repo/contracts';
import { PinoLogger } from 'nestjs-pino';

import {
  type Decimal,
  figureOrNull,
  type InvestmentMovement,
  type InvestmentPosition,
  readInvestmentByLine,
  readInvestmentMovementByLine,
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

export interface InvestmentQuery extends ReportFilters {
  from?: string;
  to?: string;
}

type Totals = NonNullable<InvestmentReport['totals']>;
type Position = NonNullable<InvestmentRow['position']>;
type Movement = NonNullable<InvestmentRow['range']>;

/**
 * M12 — the investment overview (US-085, PDF §22): per line and overall, the
 * account amount, invested amount and profit, **from the ledger** (M09) and
 * never from summing `account_loan` rows, with the contracted position set
 * against the actual one.
 *
 * Two groups, both ledger-sourced:
 *
 * - **`position`** — as of now, all time, for the accounts the line holds
 *   today (`readInvestmentByLine`): §22's contracted `A`, `I` and `P` from the
 *   DISBURSEMENT postings, then each receivable's balance as the money still
 *   out, `A −` it as the money returned, and BR-18's
 *   `round(collected × P / A)` **per account** as the profit actually earned,
 *   with the rest still unearned. Summing rounded per-line figures instead
 *   would drift a paisa an account.
 * - **`range`** — what the period's own postings did
 *   (`readInvestmentMovementByLine`): the capital deployed between `from` and
 *   `to`, the money that came back in it, and the profit recognised in it —
 *   BR-18's posted deltas, read rather than recomputed.
 *
 * Scope comes first (M02): a Senior's lines are their current line, and a
 * sector or line outside it is `404`, as a missing one is. A Senior sees their
 * own line's invested and profit — the money-visibility matrix's "own line"
 * cells.
 *
 * Each group is read on its own (S-07): one that fails is `null` on every row
 * and in the totals, never `0`.
 */
@Injectable()
export class InvestmentReportService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    query: InvestmentQuery,
    now: Date = new Date(),
  ): Promise<InvestmentReport> {
    const { from, to } = reportRange(query, now);
    const tx = this.database.client;
    await refuseOutOfScopeFilters(tx, context, query);
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
    const position = await figure('investment', () =>
      readInvestmentByLine(tx, context),
    );
    const range = await figure('movement', () =>
      readInvestmentMovementByLine(tx, context, ids, from, to),
    );

    const rows = listed
      // An inactive line is listed while it still carries an investment or
      // moved money in the range, or when it was asked for by name.
      .filter((line) => {
        if (line.isActive || line.id === query.lineId) return true;
        return carriesMoney(position?.get(line.id), range?.get(line.id));
      })
      .map((line): InvestmentRow => ({
        lineId: line.id,
        code: line.code,
        name: line.name,
        isActive: line.isActive,
        sectorId: line.sector.id,
        sectorCode: line.sector.code,
        sectorName: line.sector.name,
        position:
          position === null
            ? null
            : positionStrings(position.get(line.id) ?? emptyPosition()),
        range:
          range === null
            ? null
            : movementStrings(range.get(line.id) ?? emptyMovement()),
      }));

    return {
      from,
      to,
      generatedAt: now.toISOString(),
      lines: rows,
      totals: totalsOf(rows, {
        position: position !== null,
        range: range !== null,
      }),
    };
  }

  /** The lines in scope and filter, active or not, by code. */
  private readLines(tx: Tx, context: RequestContext, query: InvestmentQuery) {
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

const emptyPosition = (): InvestmentPosition => ({
  accounts: 0,
  accountAmount: ZERO(),
  invested: ZERO(),
  profit: ZERO(),
  outstanding: ZERO(),
  returned: ZERO(),
  profitEarned: ZERO(),
  profitToEarn: ZERO(),
});

const emptyMovement = (): InvestmentMovement => ({
  disbursements: 0,
  accountAmount: ZERO(),
  invested: ZERO(),
  profit: ZERO(),
  returned: ZERO(),
  profitEarned: ZERO(),
});

/** Whether an inactive line still has an investment worth listing. */
function carriesMoney(
  position: InvestmentPosition | undefined,
  movement: InvestmentMovement | undefined,
): boolean {
  if (position !== undefined && !position.accountAmount.isZero()) return true;
  return (
    movement !== undefined &&
    !(
      movement.accountAmount.isZero() &&
      movement.returned.isZero() &&
      movement.profitEarned.isZero()
    )
  );
}

function positionStrings(position: InvestmentPosition): Position {
  return {
    accounts: position.accounts,
    accountAmount: position.accountAmount.toFixed(2),
    invested: position.invested.toFixed(2),
    profit: position.profit.toFixed(2),
    outstanding: position.outstanding.toFixed(2),
    returned: position.returned.toFixed(2),
    profitEarned: position.profitEarned.toFixed(2),
    profitToEarn: position.profitToEarn.toFixed(2),
  };
}

function movementStrings(movement: InvestmentMovement): Movement {
  return {
    disbursements: movement.disbursements,
    accountAmount: movement.accountAmount.toFixed(2),
    invested: movement.invested.toFixed(2),
    profit: movement.profit.toFixed(2),
    returned: movement.returned.toFixed(2),
    profitEarned: movement.profitEarned.toFixed(2),
  };
}

/** The rows summed exactly — §22's "overall". A group unknown on the rows is unknown here. */
function totalsOf(
  rows: InvestmentRow[],
  known: { position: boolean; range: boolean },
): Totals {
  const sum = (pick: (row: InvestmentRow) => string): string =>
    rows
      .reduce((total: Decimal, row) => total.plus(pick(row)), ZERO())
      .toFixed(2);
  const count = (pick: (row: InvestmentRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    lines: rows.length,
    position: known.position
      ? {
          accounts: count((row) => row.position!.accounts),
          accountAmount: sum((row) => row.position!.accountAmount),
          invested: sum((row) => row.position!.invested),
          profit: sum((row) => row.position!.profit),
          outstanding: sum((row) => row.position!.outstanding),
          returned: sum((row) => row.position!.returned),
          profitEarned: sum((row) => row.position!.profitEarned),
          profitToEarn: sum((row) => row.position!.profitToEarn),
        }
      : null,
    range: known.range
      ? {
          disbursements: count((row) => row.range!.disbursements),
          accountAmount: sum((row) => row.range!.accountAmount),
          invested: sum((row) => row.range!.invested),
          profit: sum((row) => row.range!.profit),
          returned: sum((row) => row.range!.returned),
          profitEarned: sum((row) => row.range!.profitEarned),
        }
      : null,
  };
}
