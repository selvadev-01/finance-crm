import { Injectable } from '@nestjs/common';
import type { DayCloseView, JuniorSync } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  dayOfWeek,
  fromUtcMidnight,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { roleHasPermission } from '../access/permissions.js';
import {
  assignmentInEffectOn,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { AccountSettlement } from '../collections/account-settlement.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';
import { HandoverViews } from './handover-views.js';
import { lineDayFigures } from './line-day-figures.js';

type Tx = Prisma.TransactionClient;
type Decimal = ReturnType<typeof toMoney>;

const CLOSED = ['CLOSED', 'TALLIED'] as const;

/**
 * M08 day close (US-060, US-055, BR-16, BR-16a).
 *
 * The summary is **computed live** from collections, slots and handovers; the
 * `day_close` row stores the figures as they stood at the last close, reopen
 * or acknowledged handover, and the status.
 *
 * - **Close** (Senior on their line, Admin): refused while phones still hold
 *   collections unless confirmed (decided 2026-09-14: phones report their
 *   queue). Every slot due that date still `PENDING` becomes `MISSED`
 *   (US-043, decided 2026-09-14: marked at close, not by a job) and its
 *   account's tail is regenerated, so the customer is not penalised — the
 *   account simply runs a day longer (BR-06, BR-09). `TALLIED` when the cash
 *   received already matches with nothing pending, else `CLOSED`.
 * - **Reopen** (Admin, with a reason) and **automatic reopen** when a
 *   collection or an approved correction lands on a closed date (BR-16a),
 *   audited as the user whose write caused it, marked automatic.
 */
@Injectable()
export class DayCloseService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly settlement: AccountSettlement,
    private readonly handovers: HandoverViews,
    private readonly notices: EventNotices,
  ) {}

  async view(
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
    now: Date = new Date(),
  ): Promise<DayCloseView> {
    const tx = this.database.client;
    const line = await this.lineInScope(tx, context, lineId);
    const day = toUtcMidnight(businessDate);
    const row = await tx.dayClose.findUnique({
      where: { lineId_businessDate: { lineId, businessDate: day } },
    });
    const totals = await this.totals(tx, lineId, businessDate);
    const status = row?.status ?? 'OPEN';

    const collections = await tx.collection.findMany({
      where: { lineId, businessDate: day, status: 'CONFIRMED' },
      select: {
        id: true,
        entryType: true,
        amount: true,
        expectedAmount: true,
        classification: true,
        collectedByUserId: true,
        accountLoanId: true,
        accountLoan: {
          select: { accountCode: true, customer: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const slots = await tx.accountSchedule.findMany({
      where: {
        dueDate: day,
        status: { in: ['PENDING', 'MISSED'] },
        accountLoan: {
          customer: { lineId },
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
      },
      select: {
        status: true,
        expectedAmount: true,
        accountLoanId: true,
        accountLoan: {
          select: { accountCode: true, customer: { select: { name: true } } },
        },
      },
      orderBy: { accountLoan: { accountCode: 'asc' } },
    });

    const juniors = await this.juniors(tx, lineId, businessDate, collections);
    const names = await this.names(tx, [
      ...collections.map((c) => c.collectedByUserId),
      ...(row?.closedByUserId ? [row.closedByUserId] : []),
    ]);

    const exceptions: DayCloseView['exceptions'] = [
      ...collections
        .filter(
          (c) => c.entryType === 'ORIGINAL' && c.classification !== 'CORRECT',
        )
        .map((c) => ({
          kind: c.classification as 'LOW' | 'EXTRA' | 'NO_PAYMENT',
          collectionId: c.id,
          accountLoanId: c.accountLoanId,
          accountCode: c.accountLoan.accountCode,
          customerName: c.accountLoan.customer.name,
          expectedAmount: toMoney(c.expectedAmount.toString()).toFixed(2),
          amount: toMoney(c.amount.toString()).toFixed(2),
          collectedByName: names.get(c.collectedByUserId) ?? 'Unknown staff',
        })),
      ...slots.map((slot) => ({
        kind:
          slot.status === 'MISSED'
            ? ('MISSED' as const)
            : ('NOT_VISITED' as const),
        collectionId: null,
        accountLoanId: slot.accountLoanId,
        accountCode: slot.accountLoan.accountCode,
        customerName: slot.accountLoan.customer.name,
        expectedAmount: toMoney(slot.expectedAmount.toString()).toFixed(2),
        amount: null,
        collectedByName: null,
      })),
    ];

    const today = toBusinessDate(now);
    return {
      lineId,
      lineName: line.name,
      businessDate,
      day: await this.dayKind(tx, line, businessDate),
      status,
      expectedTotal: totals.expected.toFixed(2),
      collectedTotal: totals.collected.toFixed(2),
      cashReceivedTotal: totals.cashReceived.toFixed(2),
      discrepancy: totals.cashReceived.minus(totals.collected).toFixed(2),
      closedAt: row?.closedAt?.toISOString() ?? null,
      closedByName: row?.closedByUserId
        ? (names.get(row.closedByUserId) ?? 'Unknown staff')
        : null,
      reopenReason: row?.reopenReason ?? null,
      juniors,
      exceptions,
      handovers: await this.handovers.forDay(tx, context, row?.id ?? null),
      canClose:
        roleHasPermission(context.role, 'dayClose.close') &&
        (status === 'OPEN' || status === 'REOPENED') &&
        businessDate <= today,
      canReopen:
        roleHasPermission(context.role, 'dayClose.reopen') &&
        (CLOSED as readonly string[]).includes(status),
    };
  }

  async close(
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
    confirmUnsynced: boolean,
    now: Date = new Date(),
  ): Promise<DayCloseView> {
    if (businessDate > toBusinessDate(now)) {
      throw new DomainError(
        'DAY_NOT_STARTED',
        'A day can be closed only once it has begun',
      );
    }
    await this.database.transaction(async (tx) => {
      const line = await this.lineInScope(tx, context, lineId);
      const juniors = await this.juniors(tx, lineId, businessDate, []);
      const waiting = juniors.filter((junior) => junior.sync !== 'SENT');
      if (waiting.length > 0 && !confirmUnsynced) {
        throw new ConflictError(
          'UNSYNCED_DEVICES',
          `${waiting.map((junior) => junior.name).join(', ')} may still have collections on their phone. Close anyway, and a late collection will reopen the day.`,
          waiting.map((junior) => ({
            field: junior.userId,
            issue:
              junior.sync === 'UNSENT'
                ? `${junior.unsentCount} not sent`
                : 'not heard from today',
          })),
        );
      }
      // Accounts before the day's row — the order a collection takes them in
      // (account, then the day it reopens) — so the two never deadlock.
      const due = await this.lockDueAccounts(tx, lineId, businessDate);
      const row = await this.lockRow(tx, context, lineId, businessDate);
      if ((CLOSED as readonly string[]).includes(row.status)) {
        throw new ConflictError(
          'DAY_ALREADY_CLOSED',
          'This day is already closed',
        );
      }

      const missed = await this.markMissed(tx, context, due, businessDate);
      const totals = await this.totals(tx, lineId, businessDate);
      const pending = await tx.cashHandover.count({
        where: { dayCloseId: row.id, status: 'PENDING' },
      });
      const discrepancy = totals.cashReceived.minus(totals.collected);
      const status =
        discrepancy.isZero() && pending === 0 ? 'TALLIED' : 'CLOSED';
      await tx.dayClose.update({
        where: { id: row.id },
        data: {
          ...stored(totals),
          status,
          closedByUserId: context.userId,
          closedAt: now,
          reopenReason: null,
        },
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'day_close',
        entityId: row.id,
        before: { status: row.status },
        after: {
          status,
          ...stored(totals),
          unsyncedConfirmed: waiting.length > 0,
        },
      });
      // US-043: one summary to the line's Senior, not one alert per customer.
      await this.notices.dayClosedWithMissed({
        actorUserId: context.userId,
        lineId,
        lineName: line.name,
        businessDate,
        missed,
      });
    });
    return this.view(context, lineId, businessDate, now);
  }

  async reopen(
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
    reason: string,
    now: Date = new Date(),
  ): Promise<DayCloseView> {
    await this.database.transaction(async (tx) => {
      await this.lineInScope(tx, context, lineId);
      const row = await this.lockRow(tx, context, lineId, businessDate);
      if (!(CLOSED as readonly string[]).includes(row.status)) {
        throw new ConflictError(
          'DAY_NOT_CLOSED',
          'Only a closed day can be reopened',
        );
      }
      await tx.dayClose.update({
        where: { id: row.id },
        data: { status: 'REOPENED', reopenReason: reason },
      });
      await this.audit.record(context, {
        action: 'REOPEN_DAY',
        entityTable: 'day_close',
        entityId: row.id,
        before: { status: row.status },
        after: { status: 'REOPENED', reason, automatic: false },
      });
    });
    return this.view(context, lineId, businessDate, now);
  }

  /**
   * BR-16a: a collection or approved correction landed on `businessDate` for
   * `lineId`. A closed day reopens and its stored figures are recomputed.
   * Called inside the writer's transaction.
   */
  async moneyWritten(
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
  ): Promise<void> {
    const tx = this.database.client;
    const row = await tx.dayClose.findUnique({
      where: {
        lineId_businessDate: {
          lineId,
          businessDate: toUtcMidnight(businessDate),
        },
      },
    });
    if (!row || !(CLOSED as readonly string[]).includes(row.status)) return;
    await tx.$queryRaw`SELECT id FROM day_close WHERE id = ${row.id} FOR UPDATE`;
    const totals = await this.totals(tx, lineId, businessDate);
    await tx.dayClose.update({
      where: { id: row.id },
      data: { ...stored(totals), status: 'REOPENED', reopenReason: null },
    });
    await this.audit.record(context, {
      action: 'REOPEN_DAY',
      entityTable: 'day_close',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'REOPENED', automatic: true, ...stored(totals) },
    });
    const line = await tx.line.findUniqueOrThrow({
      where: { id: lineId },
      select: { name: true },
    });
    await this.notices.dayReopened({
      actorUserId: context.userId,
      lineId,
      lineName: line.name,
      businessDate,
    });
  }

  /**
   * After a handover is acknowledged: the stored cash figure moves, and a
   * closed day becomes `TALLIED` — or stops being — as the cash now stands.
   */
  async refreshTally(tx: Tx, dayCloseId: string): Promise<void> {
    const row = await tx.dayClose.findUniqueOrThrow({
      where: { id: dayCloseId },
    });
    const totals = await this.totals(
      tx,
      row.lineId,
      fromUtcMidnight(row.businessDate),
    );
    const pending = await tx.cashHandover.count({
      where: { dayCloseId, status: 'PENDING' },
    });
    const discrepancy = totals.cashReceived.minus(totals.collected);
    const status = !(CLOSED as readonly string[]).includes(row.status)
      ? row.status
      : discrepancy.isZero() && pending === 0
        ? 'TALLIED'
        : 'CLOSED';
    await tx.dayClose.update({
      where: { id: dayCloseId },
      data: { ...stored(totals), status },
    });
  }

  /** The row for a line's day, created OPEN when first needed, locked. */
  async lockRow(
    tx: Tx,
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
  ) {
    const day = toUtcMidnight(businessDate);
    await tx.$executeRaw`
      INSERT INTO day_close (id, "lineId", "businessDate", "expectedTotal", "collectedTotal", "cashReceivedTotal", discrepancy, status, "createdAt", "updatedAt", "createdByUserId")
      VALUES (${`dc_${lineId}_${businessDate}`}, ${lineId}, ${day}, 0, 0, 0, 0, 'OPEN', now(), now(), ${context.userId})
      ON CONFLICT ("lineId", "businessDate") DO NOTHING`;
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM day_close WHERE "lineId" = ${lineId} AND "businessDate" = ${day} FOR UPDATE`;
    return tx.dayClose.findUniqueOrThrow({ where: { id: locked!.id } });
  }

  /**
   * Locks, in id order, every active account on the line with a slot still
   * pending on the date. Returns their ids.
   */
  private async lockDueAccounts(
    tx: Tx,
    lineId: string,
    businessDate: CalendarDate,
  ) {
    const due = await tx.accountSchedule.findMany({
      where: {
        dueDate: toUtcMidnight(businessDate),
        status: 'PENDING',
        accountLoan: { customer: { lineId }, status: 'ACTIVE' },
      },
      select: { accountLoanId: true },
      distinct: ['accountLoanId'],
      orderBy: { accountLoanId: 'asc' },
    });
    const ids = due.map((slot) => slot.accountLoanId);
    for (const id of ids) {
      await tx.$queryRaw`SELECT id FROM account_loan WHERE id = ${id} FOR UPDATE`;
    }
    return ids;
  }

  /** The accounts are already locked by `lockDueAccounts`. */
  private async markMissed(
    tx: Tx,
    context: RequestContext,
    accountLoanIds: string[],
    businessDate: CalendarDate,
  ): Promise<number> {
    const day = toUtcMidnight(businessDate);
    let missed = 0;
    for (const accountLoanId of accountLoanIds) {
      const marked = await tx.accountSchedule.updateMany({
        where: { accountLoanId, dueDate: day, status: 'PENDING' },
        data: { status: 'MISSED' },
      });
      // Collected in the moment before the lock: nothing is missed.
      if (marked.count === 0) continue;
      missed += 1;
      const account = await tx.accountLoan.findUniqueOrThrow({
        where: { id: accountLoanId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          dailyAmount: true,
          collectionFrequency: true,
          collectedAmount: true,
          outstandingAmount: true,
          targetCompletionDate: true,
          customer: { select: { sectorId: true } },
        },
      });
      // Nothing was paid: the balance stands and the plan runs a day longer.
      await this.settlement.settle(
        context,
        account,
        toMoney('0'),
        businessDate,
      );
    }
    return missed;
  }

  /**
   * BR-16's figures for a line's day, as they stand now — the same function
   * the Admin dashboard reads (US-082), so the two always agree.
   */
  private async totals(tx: Tx, lineId: string, businessDate: CalendarDate) {
    const figures = await lineDayFigures(tx, [lineId], businessDate);
    return figures.get(lineId)!;
  }

  /**
   * Juniors working the line that day — assigned on the date, or who collected
   * on it — with what they collected and what their phone last reported.
   */
  private async juniors(
    tx: Tx,
    lineId: string,
    businessDate: CalendarDate,
    collections: {
      collectedByUserId: string;
      amount: { toString(): string };
    }[],
  ): Promise<JuniorSync[]> {
    const day = toUtcMidnight(businessDate);
    const assigned = await tx.lineAssignment.findMany({
      where: {
        lineId,
        assignmentRole: 'JUNIOR',
        ...assignmentInEffectOn(businessDate),
      },
      select: { staffProfile: { select: { userId: true } } },
    });
    const collectedRows = collections.length
      ? collections
      : await tx.collection.findMany({
          where: { lineId, businessDate: day, status: 'CONFIRMED' },
          select: { collectedByUserId: true, amount: true },
        });
    const userIds = [
      ...new Set([
        ...assigned.map((row) => row.staffProfile.userId),
        ...collectedRows.map((row) => row.collectedByUserId),
      ]),
    ];
    const staff = await tx.staffProfile.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        role: true,
        user: { select: { name: true } },
        syncReport: {
          select: { unsentCount: true, oldestUnsentAt: true, reportedAt: true },
        },
      },
    });
    return staff
      .filter((member) => member.role === 'JUNIOR')
      .map((member) => {
        const own = collectedRows.filter(
          (row) => row.collectedByUserId === member.userId,
        );
        const report = member.syncReport;
        const heard =
          report !== null && toBusinessDate(report.reportedAt) >= businessDate;
        // Unsent collections all captured after this date do not hold it open.
        const holdsThisDay =
          report !== null &&
          report.unsentCount > 0 &&
          report.oldestUnsentAt !== null &&
          toBusinessDate(report.oldestUnsentAt) <= businessDate;
        return {
          userId: member.userId,
          name: member.user.name,
          collectedAmount: own
            .reduce(
              (sum: Decimal, row) => sum.plus(row.amount.toString()),
              toMoney('0'),
            )
            .toFixed(2),
          entries: own.length,
          sync: holdsThisDay ? 'UNSENT' : heard ? 'SENT' : 'NOT_HEARD',
          unsentCount: report?.unsentCount ?? null,
          reportedAt: report?.reportedAt.toISOString() ?? null,
        } satisfies JuniorSync;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async lineInScope(tx: Tx, context: RequestContext, lineId: string) {
    return foundInScope(
      await tx.line.findFirst({
        where: inScope(lineScope(context), { id: lineId }),
        select: { id: true, name: true, sectorId: true, organizationId: true },
      }),
      'line',
    );
  }

  private async dayKind(
    tx: Tx,
    line: { sectorId: string; organizationId: string },
    businessDate: CalendarDate,
  ): Promise<DayCloseView['day']> {
    if (dayOfWeek(businessDate) === 0) return { kind: 'SUNDAY' };
    const holiday = await tx.holiday.findFirst({
      where: {
        organizationId: line.organizationId,
        date: toUtcMidnight(businessDate),
        OR: [{ sectorId: null }, { sectorId: line.sectorId }],
      },
      select: { name: true },
    });
    return holiday
      ? { kind: 'HOLIDAY', name: holiday.name }
      : { kind: 'WORKING' };
  }

  private async names(tx: Tx, userIds: string[]) {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function stored(totals: {
  expected: Decimal;
  collected: Decimal;
  cashReceived: Decimal;
}) {
  return {
    expectedTotal: totals.expected.toFixed(2),
    collectedTotal: totals.collected.toFixed(2),
    cashReceivedTotal: totals.cashReceived.toFixed(2),
    discrepancy: totals.cashReceived.minus(totals.collected).toFixed(2),
  };
}
