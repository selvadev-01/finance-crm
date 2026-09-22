import { Injectable } from '@nestjs/common';
import type { LineDashboard, WatchedAccount } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { overdueCutoff } from '../accounts/overdue-cutoff.js';
import {
  accountScope,
  collectionScope,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import { DayCloseService } from '../cash/day-close.service.js';
import { maySelfApprove } from '../collections/collection-history.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import { SettingReader } from '../settings/setting-reader.js';

type Tx = Prisma.TransactionClient;
type LineView = Extract<LineDashboard, { state: 'LINE' }>;
interface Watched {
  /** Exact, for ordering; the account carries it as a string. */
  outstanding: ReturnType<typeof toMoney>;
  account: WatchedAccount;
}

/** "Nearing completion": this many daily collections or fewer left. */
const NEARING_SLOTS = 5;
/** How many accounts each watch list carries; the total says how many more. */
const WATCH_LIMIT = 20;
const DAY_MS = 86_400_000;

/**
 * M11 — the Senior line dashboard (US-083, S-19): one line's day.
 *
 * **The day's figures are the day close's own.** Expected, collected, cash
 * received, the discrepancy, each Junior's entries and phone, and the
 * exceptions come from `DayCloseService.view` (S-05), which reads
 * `cash/line-day-figures.ts` like the Admin dashboard does — so this screen,
 * the day close and S-20 cannot show different totals for a line's day.
 *
 * **Which line.** Without `lineId`, the caller's current line — the assignment
 * in effect on today's business date (`RequestContext.currentLineId`). A
 * Senior with none gets `NO_LINE`, not an error. With `lineId`, the line must
 * be in the caller's scope, so a Senior asking for another line gets the same
 * `404` as a line that does not exist (M02).
 *
 * Decided for US-083 where the spec names a figure without defining it:
 *
 * - **Shortfall / surplus** are BR-16's, for the one line.
 * - **Nearing completion**: ACTIVE, not overdue, with outstanding at most
 *   five daily amounts.
 * - **Overdue**: BR-05's predicate — ACTIVE, outstanding above zero, target
 *   date before the cutoff in `accounts/overdue-cutoff.ts` — computed live, so
 *   it does not wait for the nightly `flag-overdue-accounts` job. The cutoff
 *   reads `account.overdueGraceDays` (M15, US-094) exactly as that job and the
 *   overdue report (M12) do, so a grace period cannot put this list and the
 *   `isOverdue` flag at odds. Both lists describe the accounts **now**,
 *   whatever date is shown: a target date moves with every collection, so an
 *   earlier day's list cannot be reconstructed.
 *
 * Like S-20, each group is read on its own and one that fails is `null`
 * (S-07), never `0`.
 */
@Injectable()
export class LineDashboardService {
  constructor(
    private readonly database: Database,
    private readonly dayCloses: DayCloseService,
    private readonly logger: PinoLogger,
    private readonly settings: SettingReader,
  ) {}

  async view(
    context: RequestContext,
    query: { date?: CalendarDate; lineId?: string },
    now: Date = new Date(),
  ): Promise<LineDashboard> {
    const today = toBusinessDate(now);
    const date = query.date ?? today;
    if (date > today) {
      throw new DomainError(
        'DATE_IN_FUTURE',
        'The dashboard shows today or an earlier day',
        [{ field: 'date', issue: 'is after today' }],
      );
    }
    const generatedAt = now.toISOString();
    const lineId = query.lineId ?? context.currentLineId;
    if (lineId === null) {
      return { state: 'NO_LINE', businessDate: date, generatedAt };
    }
    const tx = this.database.client;
    const line = await this.line(tx, context, lineId);

    const day = await this.figure(context, 'day', () =>
      this.day(context, line.lineId, date, now),
    );
    const pendingApprovals = await this.figure(
      context,
      'pendingApprovals',
      () => this.pendingApprovals(tx, context, line.lineId),
    );
    const accounts = await this.figure(context, 'accounts', () =>
      this.watchedAccounts(tx, context, line.lineId, today),
    );

    return {
      state: 'LINE',
      businessDate: date,
      generatedAt,
      line,
      day,
      pendingApprovals,
      nearingCompletion: accounts?.nearing ?? null,
      overdue: accounts?.overdue ?? null,
    };
  }

  /** S-07's partial failure, as the Admin dashboard does it. */
  private async figure<T>(
    context: RequestContext,
    group: string,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (err) {
      this.logger.error(
        { err, requestId: context.requestId },
        `Dashboard figures unavailable: ${group}`,
      );
      return null;
    }
  }

  private async line(tx: Tx, context: RequestContext, lineId: string) {
    const row = foundInScope(
      await tx.line.findFirst({
        where: inScope(lineScope(context), { id: lineId }),
        select: {
          id: true,
          code: true,
          name: true,
          sector: { select: { name: true } },
        },
      }),
      'line',
    );
    return {
      lineId: row.id,
      code: row.code,
      name: row.name,
      sectorName: row.sector.name,
    };
  }

  /** The day close's view (S-05), reshaped: the same figures, not a copy of them. */
  private async day(
    context: RequestContext,
    lineId: string,
    date: CalendarDate,
    now: Date,
  ): Promise<NonNullable<LineView['day']>> {
    const view = await this.dayCloses.view(context, lineId, date, now);
    // BR-16: a shortfall when expected exceeds collected, a surplus when collected exceeds expected.
    const gap = toMoney(view.expectedTotal).minus(view.collectedTotal);
    const received = view.handovers.filter(
      (handover) => handover.hop === 'JUNIOR_TO_SENIOR',
    );
    return {
      day: view.day,
      status: view.status,
      closedAt: view.closedAt,
      closedByName: view.closedByName,
      expected: view.expectedTotal,
      collected: view.collectedTotal,
      shortfall: (gap.greaterThan(0) ? gap : toMoney('0')).toFixed(2),
      surplus: (gap.lessThan(0) ? gap.negated() : toMoney('0')).toFixed(2),
      cashReceived: view.cashReceivedTotal,
      discrepancy: view.discrepancy,
      cashHandedOver: received.some(
        (handover) => handover.status === 'ACKNOWLEDGED',
      ),
      handovers: {
        waiting: received.filter((handover) => handover.status === 'PENDING')
          .length,
        disputed: received.filter((handover) => handover.status === 'DISPUTED')
          .length,
      },
      juniors: view.juniors,
      exceptions: view.exceptions,
    };
  }

  /**
   * Corrections on the line awaiting a decision. A Senior may decide their
   * own, so all of them wait for a Senior; an Admin's own do not (US-044).
   */
  private async pendingApprovals(
    tx: Tx,
    context: RequestContext,
    lineId: string,
  ) {
    const pending = inScope(collectionScope(context), {
      lineId,
      status: 'PENDING_APPROVAL',
    });
    const total = await tx.collection.count({ where: pending });
    if (maySelfApprove(context)) return { total, awaitingYou: total };
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

  /**
   * The line's ACTIVE accounts (by the customer's current line, M02
   * `accountScope`), sorted into nearing completion and overdue (BR-05).
   */
  private async watchedAccounts(
    tx: Tx,
    context: RequestContext,
    lineId: string,
    today: CalendarDate,
  ) {
    const rows = await tx.accountLoan.findMany({
      where: inScope(accountScope(context), {
        status: 'ACTIVE',
        outstandingAmount: { gt: 0 },
        customer: { lineId },
      }),
      select: {
        id: true,
        accountCode: true,
        dailyAmount: true,
        outstandingAmount: true,
        targetCompletionDate: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { accountCode: 'asc' },
    });
    // BR-05's cutoff, with the grace days the nightly flag and the overdue
    // report read (M15, US-094) — one definition of overdue for all three.
    const cutoff = overdueCutoff(
      today,
      await this.settings.number(
        context.organizationId,
        'account.overdueGraceDays',
      ),
    );
    const todayMidnight = toUtcMidnight(today).getTime();
    const overdue: Watched[] = [];
    const nearing: Watched[] = [];
    for (const row of rows) {
      const target = fromUtcMidnight(row.targetCompletionDate);
      const outstanding = toMoney(row.outstandingAmount.toString());
      const daily = toMoney(row.dailyAmount.toString());
      const watched: Watched = {
        outstanding,
        account: {
          accountLoanId: row.id,
          accountCode: row.accountCode,
          customerId: row.customer.id,
          customerName: row.customer.name,
          dailyAmount: daily.toFixed(2),
          outstanding: outstanding.toFixed(2),
          targetCompletionDate: target,
          // Both are UTC midnights of calendar dates: a whole number of days apart.
          daysOverdue: Math.max(
            (todayMidnight - row.targetCompletionDate.getTime()) / DAY_MS,
            0,
          ),
        },
      };
      // BR-05: overdue from the day after the target, plus the grace days.
      if (target < cutoff) overdue.push(watched);
      else if (outstanding.lessThanOrEqualTo(daily.times(NEARING_SLOTS))) {
        nearing.push(watched);
      }
    }
    // Overdue: the most outstanding first, then the longest overdue (M12).
    overdue.sort(
      (a, b) =>
        b.outstanding.comparedTo(a.outstanding) ||
        b.account.daysOverdue - a.account.daysOverdue,
    );
    // Nearing: the closest to done first.
    nearing.sort(
      (a, b) =>
        a.outstanding.comparedTo(b.outstanding) ||
        a.account.targetCompletionDate.localeCompare(
          b.account.targetCompletionDate,
        ),
    );
    const list = (items: Watched[]) => ({
      total: items.length,
      items: items.slice(0, WATCH_LIMIT).map((item) => item.account),
    });
    return { overdue: list(overdue), nearing: list(nearing) };
  }
}
