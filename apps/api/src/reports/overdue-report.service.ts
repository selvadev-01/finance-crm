import { Injectable } from '@nestjs/common';
import type {
  OverdueAccount,
  OverdueReport,
  OverdueSort,
  OverdueSummary,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  daysBetween,
  fromUtcMidnight,
  isCalendarDate,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { overdueCutoff } from '../accounts/overdue-cutoff.js';
import { accountScope, inScope } from '../access/scope.js';
import {
  type AccountArrears,
  type Decimal,
  figureOrNull,
  readArrearsByAccount,
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
import { SettingReader } from '../settings/setting-reader.js';
import {
  refuseOutOfScopeFilters,
  type ReportFilters,
  reportLineWhere,
} from './report-filters.js';

export interface OverdueReportQuery extends ReportFilters, PageRequest {
  minDaysOverdue?: number;
  sort: OverdueSort;
}

type LineRow = {
  id: string;
  code: string;
  name: string;
  sector: { id: string; name: string };
};

const accountSelect = {
  id: true,
  accountCode: true,
  accountAmount: true,
  dailyAmount: true,
  outstandingAmount: true,
  targetCompletionDate: true,
  customer: { select: { id: true, name: true, lineId: true } },
} satisfies Prisma.AccountLoanSelect;

type AccountRow = Prisma.AccountLoanGetPayload<{
  select: typeof accountSelect;
}>;

/**
 * M12 — the overdue report (US-087): the accounts still `ACTIVE` past their
 * target completion date with money outstanding, one row each, ordered by how
 * long they have been overdue or by how much they still owe, and cursor-paged
 * as the collection list is (S-16).
 *
 * **Overdue is read from the dates, not from the flag.** BR-05's `isOverdue`
 * is set nightly by `accounts/overdue.service.ts`; this report applies the
 * same three conditions itself — active, outstanding above zero, target
 * completion date before the cutoff — so an account that fell overdue this
 * morning is on the report before the job next runs. The cutoff is
 * `accounts/overdue-cutoff.ts` and the grace days behind it are
 * `account.overdueGraceDays` (M15, US-094), read here as the job reads them,
 * so the two cannot disagree about what "overdue" means at any grace value.
 *
 * **No date range.** The other three reports are period questions; this one is
 * the position now. BR-06 regenerates a schedule's tail after every
 * collection, so the plan as it stands cannot say who was overdue on an
 * earlier day, and a date parameter would invite exactly that question.
 *
 * Scope comes first (M02): the lines are `lineScope`'s, so a Senior's rows are
 * their own line's accounts, and a sector or line outside their scope is
 * `404`, as a missing one is. Each group is read on its own (S-07): the
 * arrears behind a row, and the summary band over the whole set, are `null`
 * when they cannot be read — never `0`.
 */
@Injectable()
export class OverdueReportService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
    private readonly settings: SettingReader,
  ) {}

  async view(
    context: RequestContext,
    query: OverdueReportQuery,
    now: Date = new Date(),
  ): Promise<OverdueReport> {
    const today = toBusinessDate(now);
    const tx = this.database.client;
    await refuseOutOfScopeFilters(tx, context, query);
    const lines = await tx.line.findMany({
      where: reportLineWhere(context, query),
      select: {
        id: true,
        code: true,
        name: true,
        sector: { select: { id: true, name: true } },
      },
    });
    const lineById = new Map<string, LineRow>(
      lines.map((line) => [line.id, line]),
    );
    const grace = await this.settings.number(
      context.organizationId,
      'account.overdueGraceDays',
    );
    const where = this.overdueWhere(
      context,
      [...lineById.keys()],
      today,
      grace,
      query,
    );

    const rows = await tx.accountLoan.findMany({
      where: { AND: [where, keysetWhere(query)] },
      select: accountSelect,
      orderBy: orderFor(query.sort),
      take: query.limit + 1,
    });

    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);
    const arrears = await figure('arrears', () =>
      readArrearsByAccount(
        tx,
        rows.map((row) => row.id),
        today,
      ),
    );
    const summary = await figure('summary', () =>
      this.readSummary(tx, where, today),
    );

    const page = toPageBy(
      rows,
      query,
      (row) => cursorOf(row, query.sort),
      (row): OverdueAccount => {
        const line = lineById.get(row.customer.lineId)!;
        const target = fromUtcMidnight(row.targetCompletionDate);
        return {
          accountLoanId: row.id,
          accountCode: row.accountCode,
          customerId: row.customer.id,
          customerName: row.customer.name,
          lineId: line.id,
          lineCode: line.code,
          lineName: line.name,
          sectorId: line.sector.id,
          sectorName: line.sector.name,
          dailyAmount: row.dailyAmount.toFixed(2),
          accountAmount: row.accountAmount.toFixed(2),
          outstanding: row.outstandingAmount.toFixed(2),
          targetCompletionDate: target,
          daysOverdue: daysBetween(target, today),
          arrears: arrearsOf(arrears?.get(row.id), today),
        };
      },
    );
    return { ...page, asOf: today, generatedAt: now.toISOString(), summary };
  }

  /**
   * BR-05's three conditions, inside the caller's scope and the report's
   * filters. `minDaysOverdue` is the same condition read backwards: overdue by
   * at least `n` days is a target completion date `n` days or more ago.
   *
   * Two cutoffs meet here, and the **stricter — the earlier date — wins**: the
   * grace days settle who is overdue at all, and `minDaysOverdue` only narrows
   * that set further. A filter of "overdue by at least 1 day" can therefore
   * never drag back an account the grace period is still covering.
   */
  private overdueWhere(
    context: RequestContext,
    lineIds: string[],
    today: CalendarDate,
    graceDays: number,
    query: OverdueReportQuery,
  ): Prisma.AccountLoanWhereInput {
    const graced = overdueCutoff(today, graceDays);
    const asked =
      query.minDaysOverdue === undefined
        ? today
        : addCalendarDays(today, -(query.minDaysOverdue - 1));
    const latest = asked < graced ? asked : graced;
    return inScope(accountScope(context), {
      status: 'ACTIVE',
      outstandingAmount: { gt: 0 },
      targetCompletionDate: { lt: toUtcMidnight(latest) },
      customer: { lineId: { in: lineIds } },
    });
  }

  /**
   * The band above the table: the whole overdue set, not the page. It reads
   * every matching account — the set is by nature small next to the book, and
   * a total that only covered the first page would be worse than none.
   */
  private async readSummary(
    tx: Tx,
    where: Prisma.AccountLoanWhereInput,
    today: CalendarDate,
  ): Promise<OverdueSummary> {
    const matched = await tx.accountLoan.findMany({
      where,
      select: {
        id: true,
        accountCode: true,
        outstandingAmount: true,
        targetCompletionDate: true,
        customer: { select: { name: true, lineId: true } },
      },
      orderBy: [
        { targetCompletionDate: 'asc' },
        { outstandingAmount: 'desc' },
        { id: 'asc' },
      ],
    });
    const arrears = await readArrearsByAccount(
      tx,
      matched.map((row) => row.id),
      today,
    );
    const outstanding = matched.reduce(
      (total: Decimal, row) => total.plus(row.outstandingAmount.toString()),
      ZERO(),
    );
    const behind = [...arrears.values()].reduce(
      (total: Decimal, account) => total.plus(account.amount),
      ZERO(),
    );
    const longest = matched[0];
    return {
      accounts: matched.length,
      lines: new Set(matched.map((row) => row.customer.lineId)).size,
      outstanding: outstanding.toFixed(2),
      arrears: behind.toFixed(2),
      longestOverdue:
        longest === undefined
          ? null
          : {
              accountLoanId: longest.id,
              accountCode: longest.accountCode,
              customerName: longest.customer.name,
              daysOverdue: daysBetween(
                fromUtcMidnight(longest.targetCompletionDate),
                today,
              ),
            },
    };
  }
}

function arrearsOf(
  account: AccountArrears | undefined,
  today: CalendarDate,
): OverdueAccount['arrears'] {
  if (account === undefined) return null;
  return {
    amount: account.amount.toFixed(2),
    unpaidDays: account.unpaidDays,
    lastCollection:
      account.lastCollection === null
        ? null
        : {
            businessDate: account.lastCollection.businessDate,
            amount: account.lastCollection.amount.toFixed(2),
            daysAgo: daysBetween(account.lastCollection.businessDate, today),
          },
  };
}

/**
 * M12 names two orders: how long an account has been overdue — the oldest
 * target completion date first — and how much it still owes. The account id
 * settles ties, so the order is total and a page boundary can neither repeat
 * nor drop a row.
 */
function orderFor(
  sort: OverdueSort,
): Prisma.AccountLoanOrderByWithRelationInput[] {
  return sort === 'outstanding'
    ? [{ outstandingAmount: 'desc' }, { id: 'asc' }]
    : [{ targetCompletionDate: 'asc' }, { id: 'asc' }];
}

/** The ordering value and the id, which together place a row exactly. */
function cursorOf(row: AccountRow, sort: OverdueSort): string {
  const key =
    sort === 'outstanding'
      ? row.outstandingAmount.toFixed(2)
      : fromUtcMidnight(row.targetCompletionDate);
  return `${key}|${row.id}`;
}

/** Keyset paging: the rows after the cursor in the order asked for. */
function keysetWhere(query: OverdueReportQuery): Prisma.AccountLoanWhereInput {
  if (query.cursor === undefined) return {};
  const decoded = decodeCursor(query.cursor);
  const at = decoded.indexOf('|');
  const key = at === -1 ? '' : decoded.slice(0, at);
  const id = decoded.slice(at + 1);
  if (key === '' || id === '') throw badCursor();
  if (query.sort === 'outstanding') {
    if (!/^\d{1,12}\.\d{2}$/.test(key)) throw badCursor();
    return {
      OR: [
        { outstandingAmount: { lt: key } },
        { AND: [{ outstandingAmount: key }, { id: { gt: id } }] },
      ],
    };
  }
  if (!isCalendarDate(key)) throw badCursor();
  const date = toUtcMidnight(key);
  return {
    OR: [
      { targetCompletionDate: { gt: date } },
      { AND: [{ targetCompletionDate: date }, { id: { gt: id } }] },
    ],
  };
}

const badCursor = () =>
  new ValidationError('INVALID_CURSOR', 'The page cursor is not valid', [
    { field: 'cursor', issue: 'is not a cursor this API issued' },
  ]);
