import { Injectable } from '@nestjs/common';
import type {
  AttentionItem,
  LineToday,
  OperationsDashboard,
  SectorToday,
} from '@repo/contracts';
import {
  addCalendarDays,
  businessDayStart,
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toMoney,
} from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import {
  collectionScope,
  customerScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import {
  businessDay,
  figureOrNull,
  linesBySector,
  readAccountCounts,
  readDisbursedTotals,
  readHolidays,
  readLines,
  sumLines,
  type Tx,
} from './business-figures.js';

/** How many open disputes the list carries; the rest are on the cash pages. */
const DISPUTE_LIMIT = 20;

/**
 * M11 — the Admin operational dashboard (US-082, S-20, PDF §21).
 *
 * Computed live (M11 computation strategy) from the same scoped queries the
 * rest of the API uses. **Each group of figures is read on its own**: one that
 * fails is logged and returned as `null`, and the screen shows it as
 * unavailable — never as `0` (S-07). Groups that are built from another
 * (today's totals and the sectors from the lines; the attention list from
 * everything) are `null` whenever what they are built from is.
 *
 * The lines, account counts and ledger totals are read through
 * `business-figures.ts`, which the business overview (US-080) shares.
 *
 * Decided for US-082 where the PDF names a figure without defining it:
 *
 * - **Pending** and **extra** are BR-16's shortfall and surplus, taken **per
 *   line** and summed, so one line's surplus never hides another's shortfall.
 * - **Low** and **extra** counts are that day's original collections
 *   classified LOW / EXTRA (BR-08), as the day close lists them.
 * - **New customers** were onboarded on the date; **active customers** are
 *   ACTIVE and hold at least one ACTIVE account.
 * - **Invested** and **profit** are the ledger's DISBURSEMENT postings (credit
 *   office cash `I`, credit unearned profit `P`, BR-18) — every account ever
 *   disbursed, which is §22's "overall" and what the ledger reconciles.
 */
@Injectable()
export class OperationsDashboardService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    businessDate: CalendarDate | undefined,
    now: Date = new Date(),
  ): Promise<OperationsDashboard> {
    const today = toBusinessDate(now);
    const date = businessDate ?? today;
    if (date > today) {
      throw new DomainError(
        'DATE_IN_FUTURE',
        'The dashboard shows today or an earlier day',
        [{ field: 'date', issue: 'is after today' }],
      );
    }
    const tx = this.database.client;
    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);

    const holidays = await figure('holidays', () =>
      readHolidays(tx, context, date),
    );
    const lines =
      holidays === null
        ? null
        : await figure('lines', () => readLines(tx, context, date, holidays));
    const pendingApprovals = await figure('pendingApprovals', () =>
      this.pendingApprovals(tx, context),
    );
    const customers = await figure('customers', () =>
      this.customers(tx, context, date),
    );
    const accounts = await figure('accounts', () =>
      readAccountCounts(tx, context),
    );
    const investment = await figure('investment', async () => {
      const { invested, profit } = await readDisbursedTotals(tx, context);
      return { invested, profit };
    });
    const disputes = await figure('disputes', () => this.disputes(tx, context));

    return {
      businessDate: date,
      day: businessDay(date, holidays),
      generatedAt: now.toISOString(),
      today: lines === null ? null : todayTotals(lines),
      pendingApprovals,
      customers,
      accounts,
      investment,
      sectors: lines === null ? null : sectorTotals(lines),
      lines,
      attention:
        lines === null || pendingApprovals === null || disputes === null
          ? null
          : attention(lines, pendingApprovals, disputes, date < today),
    };
  }

  private async pendingApprovals(tx: Tx, context: RequestContext) {
    const pending = inScope(collectionScope(context), {
      status: 'PENDING_APPROVAL',
    });
    const total = await tx.collection.count({ where: pending });
    // Self-approval is blocked (US-044): a request of your own waits for someone else.
    const mine = await tx.collection.count({
      where: {
        AND: [
          pending,
          { approval: { is: { requestedByUserId: context.userId } } },
        ],
      },
    });
    return { total, awaitingYou: total - mine };
  }

  private async customers(tx: Tx, context: RequestContext, date: CalendarDate) {
    const onboarded = await tx.customer.count({
      where: inScope(customerScope(context), {
        deletedAt: null,
        createdAt: {
          gte: businessDayStart(date),
          lt: businessDayStart(addCalendarDays(date, 1)),
        },
      }),
    });
    const active = await tx.customer.count({
      where: inScope(customerScope(context), {
        deletedAt: null,
        status: 'ACTIVE',
        accountLoans: { some: { status: 'ACTIVE' } },
      }),
    });
    return { new: onboarded, active };
  }

  /**
   * Disputed handovers whose day has not tallied since — a dispute is
   * resolved by a fresh count that reconciles the day (BR-16, BR-17).
   */
  private async disputes(tx: Tx, context: RequestContext) {
    const rows = await tx.cashHandover.findMany({
      where: {
        status: 'DISPUTED',
        dayClose: {
          status: { not: 'TALLIED' },
          line: inScope(lineScope(context)),
        },
      },
      select: {
        id: true,
        fromUserId: true,
        discrepancy: true,
        dayClose: {
          select: {
            businessDate: true,
            line: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: DISPUTE_LIMIT,
    });
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.fromUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row): AttentionItem => ({
      kind: 'DISPUTED_HANDOVER',
      handoverId: row.id,
      lineId: row.dayClose.line.id,
      lineCode: row.dayClose.line.code,
      lineName: row.dayClose.line.name,
      businessDate: fromUtcMidnight(row.dayClose.businessDate),
      fromName: names.get(row.fromUserId) ?? 'Unknown staff',
      discrepancy: toMoney(row.discrepancy.toString()).toFixed(2),
    }));
  }
}

/** Today's money, summed over the lines (BR-16 per line). */
function todayTotals(
  lines: LineToday[],
): NonNullable<OperationsDashboard['today']> {
  const sum = sumLines(lines);
  return {
    expected: sum.expected,
    collected: sum.collected,
    pending: sum.pending,
    extra: sum.extra,
    lowCount: sum.lowCount,
    extraCount: sum.extraCount,
    linesToClose: sum.linesToClose,
    linesNotClosed: sum.linesToClose - sum.linesClosed,
  };
}

function sectorTotals(lines: LineToday[]): SectorToday[] {
  return linesBySector(lines).map((group) => {
    const first = group[0]!;
    const sum = sumLines(group);
    return {
      sectorId: first.sectorId,
      code: first.sectorCode,
      name: first.sectorName,
      lineCount: group.length,
      activeAccounts: group.reduce((n, line) => n + line.activeAccounts, 0),
      expected: sum.expected,
      collected: sum.collected,
    };
  });
}

/** Most urgent first: money in dispute, then customers not visited, then the rest. */
function attention(
  lines: LineToday[],
  approvals: { total: number; awaitingYou: number },
  disputes: AttentionItem[],
  isPast: boolean,
): AttentionItem[] {
  const ref = (line: LineToday) => ({
    lineId: line.lineId,
    lineCode: line.code,
    lineName: line.name,
  });
  const items: AttentionItem[] = [...disputes];
  for (const line of lines) {
    if (line.missedCount > 0) {
      items.push({ kind: 'MISSED', ...ref(line), count: line.missedCount });
    }
  }
  if (isPast) {
    for (const line of lines) {
      if (
        line.isActive &&
        line.day.kind === 'WORKING' &&
        (line.status === 'OPEN' || line.status === 'REOPENED')
      ) {
        items.push({
          kind: 'DAY_NOT_CLOSED',
          ...ref(line),
          status: line.status,
        });
      }
    }
  }
  if (approvals.total > 0) {
    items.push({
      kind: 'PENDING_APPROVALS',
      count: approvals.total,
      awaitingYou: approvals.awaitingYou,
    });
  }
  for (const line of lines) {
    if (line.isActive && line.seniorName === null) {
      items.push({ kind: 'NO_SENIOR', ...ref(line) });
    }
  }
  for (const line of lines) {
    if (line.isActive && line.activeAccounts > 0 && line.juniorCount === 0) {
      items.push({ kind: 'NO_JUNIOR', ...ref(line) });
    }
  }
  return items;
}
