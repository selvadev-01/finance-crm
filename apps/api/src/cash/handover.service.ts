import { Injectable } from '@nestjs/common';
import {
  type CashPosition,
  DENOMINATIONS,
  type Handover,
  type cashContract,
  type RouteInput,
} from '@repo/contracts';
import { Prisma } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { assignmentInEffectOn, foundInScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
} from '../platform/errors/errors.js';
import { DayCloseService } from './day-close.service.js';
import { handoverSelect, HandoverViews } from './handover-views.js';

type Tx = Prisma.TransactionClient;
type HandOverInput = Omit<
  RouteInput<typeof cashContract.handOver>['body'],
  'note'
> & {
  note?: string | undefined;
};

/** How far back the cash position looks for cash not yet handed over. */
const POSITION_DAYS = 14;

/**
 * M08 cash handovers (US-061…US-064, BR-17). Two hops, one mechanism:
 *
 * - **Junior → Senior** — the Junior's collections on a line and date, to the
 *   Senior assigned to that line on that date.
 * - **Senior → office** — what the Senior acknowledged from Juniors on their
 *   line that date, to an Admin the Senior picks (decided 2026-09-14), posted
 *   to the organisation's `CASH_AT_OFFICE`.
 *
 * The declared amount is **computed from the nine denomination counts**; a
 * difference from the system amount is recorded with a required note and
 * never blocks (US-061). `systemAmount` is what Rasi recorded less what
 * earlier acknowledged handovers already covered, so a late collection can be
 * handed over later. One pending handover per sender and day (database).
 *
 * **Acknowledgement is the moment cash moves** (BR-17): only the receiver, and
 * it posts a `HANDOVER` ledger transaction for the declared amount (decided
 * 2026-09-14), then re-tallies the day. A **dispute** — by either party or an
 * Admin, while pending — is final: nothing posts and the sender counts again
 * (decided 2026-09-14).
 */
@Injectable()
export class HandoverService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
    private readonly dayCloses: DayCloseService,
    private readonly views: HandoverViews,
    private readonly notices: EventNotices,
  ) {}

  async position(
    context: RequestContext,
    now: Date = new Date(),
  ): Promise<CashPosition> {
    const tx = this.database.client;
    const today = toBusinessDate(now);
    const since = toUtcMidnight(addCalendarDays(today, -(POSITION_DAYS - 1)));
    const items: CashPosition['items'] = [];

    if (context.role === 'JUNIOR') {
      const groups = await tx.collection.groupBy({
        by: ['lineId', 'businessDate'],
        where: {
          collectedByUserId: context.userId,
          status: 'CONFIRMED',
          businessDate: { gte: since },
        },
        _sum: { amount: true },
      });
      for (const group of groups) {
        const businessDate = fromUtcMidnight(group.businessDate);
        const recorded = toMoney((group._sum.amount ?? 0).toString());
        const { toHandOver, pending } = await this.remaining(
          tx,
          context,
          group.lineId,
          businessDate,
          recorded,
        );
        if (toHandOver.isZero() && !pending) continue;
        const line = await tx.line.findUniqueOrThrow({
          where: { id: group.lineId },
          select: { name: true },
        });
        const senior = await this.seniorOn(tx, group.lineId, businessDate);
        items.push({
          lineId: group.lineId,
          lineName: line.name,
          businessDate,
          hop: 'JUNIOR_TO_SENIOR',
          toHandOver: toHandOver.toFixed(2),
          receiver: senior,
          pending,
        });
      }
    } else if (context.role === 'SENIOR' && context.currentLineId) {
      const days = await tx.dayClose.findMany({
        where: { lineId: context.currentLineId, businessDate: { gte: since } },
        select: {
          id: true,
          lineId: true,
          businessDate: true,
          line: { select: { name: true } },
        },
      });
      for (const day of days) {
        const businessDate = fromUtcMidnight(day.businessDate);
        const received = await this.receivedBySenior(tx, context, day.id);
        const { toHandOver, pending } = await this.remaining(
          tx,
          context,
          day.lineId,
          businessDate,
          received,
        );
        if (toHandOver.isZero() && !pending) continue;
        items.push({
          lineId: day.lineId,
          lineName: day.line.name,
          businessDate,
          hop: 'SENIOR_TO_OFFICE',
          toHandOver: toHandOver.toFixed(2),
          receiver: null,
          pending,
        });
      }
    }

    const recent = await tx.cashHandover.findMany({
      where: { fromUserId: context.userId },
      select: handoverSelect,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return {
      items: items.sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1)),
      officeReceivers:
        context.role === 'SENIOR'
          ? await this.officeReceivers(tx, context)
          : [],
      recent: await this.views.toViews(tx, context, recent),
    };
  }

  async handOver(
    context: RequestContext,
    input: HandOverInput,
    now: Date = new Date(),
  ): Promise<Handover> {
    const businessDate = parseCalendarDate(input.businessDate);
    if (businessDate > toBusinessDate(now)) {
      throw new DomainError(
        'DAY_NOT_STARTED',
        'Cash for a day that has not begun cannot be handed over',
      );
    }
    const counts = normaliseCounts(input.counts);
    const declared = counts.reduce(
      (sum, row) => sum.plus(row.subtotal),
      toMoney('0'),
    );
    try {
      return await this.database.transaction(async (tx) => {
        const hop =
          context.role === 'JUNIOR' ? 'JUNIOR_TO_SENIOR' : 'SENIOR_TO_OFFICE';
        let toUserId: string;
        let recorded: ReturnType<typeof toMoney>;
        foundInScope(
          await tx.line.findFirst({
            where: { id: input.lineId, organizationId: context.organizationId },
            select: { id: true },
          }),
          'line',
        );
        const day = await this.dayCloses.lockRow(
          tx,
          context,
          input.lineId,
          businessDate,
        );

        if (hop === 'JUNIOR_TO_SENIOR') {
          const senior = await this.seniorOn(tx, input.lineId, businessDate);
          if (!senior) {
            throw new DomainError(
              'NO_SENIOR_ON_LINE',
              'No Senior is assigned to this line for that day; ask an Admin',
            );
          }
          toUserId = senior.userId;
          const sum = await tx.collection.aggregate({
            where: {
              collectedByUserId: context.userId,
              lineId: input.lineId,
              businessDate: toUtcMidnight(businessDate),
              status: 'CONFIRMED',
            },
            _sum: { amount: true },
          });
          recorded = toMoney((sum._sum.amount ?? 0).toString());
          // A Junior hands over their own collections, never cash for a line
          // and day they recorded nothing on: that would move money in the
          // ledger and into another line's tally with nothing behind it.
          if (!recorded.greaterThan(0)) {
            throw new DomainError(
              'NOTHING_TO_HAND_OVER',
              'You have no collections recorded on this line for that day',
            );
          }
        } else {
          // A Senior hands over only their own line's cash.
          foundInScope(
            context.currentLineId === input.lineId ? input.lineId : null,
            'line',
          );
          const receivers = await this.officeReceivers(tx, context);
          const receiver = receivers.find(
            (candidate) => candidate.userId === input.toUserId,
          );
          if (!receiver) {
            throw new DomainError(
              'RECEIVER_NOT_ADMIN',
              'Choose an Admin to hand the cash to',
              [
                {
                  field: 'toUserId',
                  issue: 'must be an active Admin in your organisation',
                },
              ],
            );
          }
          toUserId = receiver.userId;
          recorded = await this.receivedBySenior(tx, context, day.id);
        }

        const { toHandOver, pending } = await this.remaining(
          tx,
          context,
          input.lineId,
          businessDate,
          recorded,
        );
        if (pending) throw pendingConflict();
        const discrepancy = declared.minus(toHandOver);
        if (declared.isZero() && toHandOver.isZero()) {
          throw new DomainError(
            'NOTHING_TO_HAND_OVER',
            'There is no cash recorded for this day to hand over',
          );
        }
        if (!discrepancy.isZero() && !input.note) {
          throw new DomainError(
            'NOTE_REQUIRED',
            `The count differs from the recorded ₹${toHandOver.toFixed(2)}; say why`,
            [
              {
                field: 'note',
                issue:
                  'required when the count differs from the recorded amount',
              },
            ],
          );
        }

        const created = await tx.cashHandover.create({
          data: {
            dayCloseId: day.id,
            fromUserId: context.userId,
            toUserId,
            hop,
            declaredAmount: declared.toFixed(2),
            systemAmount: toHandOver.toFixed(2),
            discrepancy: discrepancy.toFixed(2),
            note: input.note ?? null,
            createdByUserId: context.userId,
            denominations: {
              create: counts.map((row) => ({
                denomination: row.denomination,
                count: row.count,
                subtotal: row.subtotal.toFixed(2),
              })),
            },
          },
          select: handoverSelect,
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'cash_handover',
          entityId: created.id,
          after: {
            hop,
            toUserId,
            declaredAmount: declared.toFixed(2),
            systemAmount: toHandOver.toFixed(2),
            discrepancy: discrepancy.toFixed(2),
          },
        });
        const [view] = await this.views.toViews(tx, context, [created]);
        await this.notices.handoverSubmitted({
          actorUserId: context.userId,
          toUserId,
          lineName: view!.lineName,
          businessDate,
          declaredAmount: view!.declaredAmount,
          discrepancy: view!.discrepancy,
        });
        return view!;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw pendingConflict();
      }
      throw error;
    }
  }

  async list(
    context: RequestContext,
    status?: Handover['status'],
  ): Promise<{ data: Handover[] }> {
    const tx = this.database.client;
    const rows = await tx.cashHandover.findMany({
      where: { toUserId: context.userId, ...(status ? { status } : {}) },
      select: handoverSelect,
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const views = await this.views.toViews(tx, context, rows);
    return {
      data: views.sort(
        (a, b) =>
          Number(b.status === 'PENDING') - Number(a.status === 'PENDING'),
      ),
    };
  }

  async acknowledge(
    context: RequestContext,
    handoverId: string,
    now: Date = new Date(),
  ): Promise<Handover> {
    return this.database.transaction(async (tx) => {
      const found = await this.inScope(tx, context, handoverId);
      if (found.toUserId !== context.userId) {
        throw new AuthorizationError(
          'NOT_THE_RECEIVER',
          'Only the person receiving the cash can acknowledge it',
        );
      }
      await tx.$queryRaw`SELECT id FROM day_close WHERE id = ${found.dayCloseId} FOR UPDATE`;
      const row = await tx.cashHandover.findUniqueOrThrow({
        where: { id: handoverId },
        select: { ...handoverSelect, dayCloseId: true },
      });
      if (row.status !== 'PENDING') {
        throw new ConflictError(
          'HANDOVER_NOT_PENDING',
          `This handover is already ${row.status.toLowerCase()}`,
        );
      }
      const organizationId = context.organizationId;
      const declared = toMoney(row.declaredAmount.toString());
      if (declared.greaterThan(0)) {
        const sender = await this.ledger.cashInHand(
          organizationId,
          row.fromUserId,
        );
        const receiver =
          row.hop === 'SENIOR_TO_OFFICE'
            ? await this.ledger.organizationAccount(
                organizationId,
                'CASH_AT_OFFICE',
              )
            : await this.ledger.cashInHand(organizationId, row.toUserId);
        await this.ledger.post(context, {
          transactionType: 'HANDOVER',
          source: { table: 'cash_handover', id: row.id },
          businessDate: fromUtcMidnight(row.dayClose.businessDate),
          eventAt: now,
          description: `Handover ${row.hop === 'SENIOR_TO_OFFICE' ? 'to office' : 'to Senior'} · ${row.dayClose.line.name}`,
          lines: [
            {
              ledgerAccountId: receiver,
              direction: 'DEBIT',
              amount: declared.toFixed(2),
            },
            {
              ledgerAccountId: sender,
              direction: 'CREDIT',
              amount: declared.toFixed(2),
            },
          ],
        });
      }
      const updated = await tx.cashHandover.update({
        where: { id: row.id },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: now },
        select: handoverSelect,
      });
      await this.dayCloses.refreshTally(tx, row.dayCloseId);
      await this.audit.record(context, {
        action: 'APPROVE',
        entityTable: 'cash_handover',
        entityId: row.id,
        before: { status: 'PENDING' },
        after: { status: 'ACKNOWLEDGED', declaredAmount: declared.toFixed(2) },
      });
      const [view] = await this.views.toViews(tx, context, [updated]);
      await this.notices.handoverDiscrepancy({
        actorUserId: context.userId,
        organizationId: context.organizationId,
        lineId: view!.lineId,
        lineName: view!.lineName,
        businessDate: parseCalendarDate(view!.businessDate),
        discrepancy: view!.discrepancy,
      });
      return view!;
    });
  }

  async dispute(
    context: RequestContext,
    handoverId: string,
    note: string,
  ): Promise<Handover> {
    return this.database.transaction(async (tx) => {
      const found = await this.inScope(tx, context, handoverId);
      const admin = context.role === 'ADMIN' || context.role === 'SUPER_ADMIN';
      if (
        !admin &&
        found.fromUserId !== context.userId &&
        found.toUserId !== context.userId
      ) {
        throw new AuthorizationError(
          'NOT_A_PARTY',
          'Only the sender, the receiver or an Admin can dispute a handover',
        );
      }
      await tx.$queryRaw`SELECT id FROM day_close WHERE id = ${found.dayCloseId} FOR UPDATE`;
      const current = await tx.cashHandover.findUniqueOrThrow({
        where: { id: handoverId },
        select: { status: true },
      });
      if (current.status !== 'PENDING') {
        throw new ConflictError(
          'HANDOVER_NOT_PENDING',
          current.status === 'ACKNOWLEDGED'
            ? 'This cash was already acknowledged and has moved; it cannot be disputed'
            : 'This handover is already disputed',
        );
      }
      const updated = await tx.cashHandover.update({
        where: { id: handoverId },
        data: { status: 'DISPUTED', disputeNote: note },
        select: handoverSelect,
      });
      await this.dayCloses.refreshTally(tx, found.dayCloseId);
      await this.audit.record(context, {
        action: 'REJECT',
        entityTable: 'cash_handover',
        entityId: handoverId,
        before: { status: 'PENDING' },
        after: { status: 'DISPUTED', note },
      });
      const [view] = await this.views.toViews(tx, context, [updated]);
      await this.notices.handoverDisputed({
        actorUserId: context.userId,
        organizationId: context.organizationId,
        fromUserId: view!.fromUserId,
        toUserId: view!.toUserId,
        lineName: view!.lineName,
        businessDate: parseCalendarDate(view!.businessDate),
        declaredAmount: view!.declaredAmount,
        note,
      });
      return view!;
    });
  }

  /**
   * A handover the caller may see: an Admin's organisation, a Senior's line,
   * or one they sent or receive. Anything else is `404` (M02).
   */
  private async inScope(tx: Tx, context: RequestContext, handoverId: string) {
    const admin = context.role === 'ADMIN' || context.role === 'SUPER_ADMIN';
    const scope: Prisma.CashHandoverWhereInput = admin
      ? { dayClose: { line: { organizationId: context.organizationId } } }
      : {
          OR: [
            { fromUserId: context.userId },
            { toUserId: context.userId },
            ...(context.role === 'SENIOR' && context.currentLineId
              ? [{ dayClose: { lineId: context.currentLineId } }]
              : []),
          ],
        };
    return foundInScope(
      await tx.cashHandover.findFirst({
        where: { AND: [scope, { id: handoverId }] },
        select: {
          id: true,
          fromUserId: true,
          toUserId: true,
          dayCloseId: true,
        },
      }),
      'handover',
    );
  }

  /** What the sender still holds for a line's day, and any handover waiting. */
  private async remaining(
    tx: Tx,
    context: RequestContext,
    lineId: string,
    businessDate: CalendarDate,
    recorded: ReturnType<typeof toMoney>,
  ) {
    const rows = await tx.cashHandover.findMany({
      where: {
        fromUserId: context.userId,
        dayClose: { lineId, businessDate: toUtcMidnight(businessDate) },
        status: { in: ['PENDING', 'ACKNOWLEDGED'] },
      },
      select: handoverSelect,
    });
    const covered = rows
      .filter((row) => row.status === 'ACKNOWLEDGED')
      .reduce(
        (sum, row) => sum.plus(row.systemAmount.toString()),
        toMoney('0'),
      );
    const waiting = rows.find((row) => row.status === 'PENDING');
    const left = recorded.minus(covered);
    return {
      toHandOver: left.isNegative() ? toMoney('0') : left,
      pending: waiting
        ? (await this.views.toViews(tx, context, [waiting]))[0]!
        : null,
    };
  }

  /** Σ declared of the Juniors' handovers this Senior acknowledged for the day. */
  private async receivedBySenior(
    tx: Tx,
    context: RequestContext,
    dayCloseId: string,
  ) {
    const sum = await tx.cashHandover.aggregate({
      where: {
        dayCloseId,
        toUserId: context.userId,
        hop: 'JUNIOR_TO_SENIOR',
        status: 'ACKNOWLEDGED',
      },
      _sum: { declaredAmount: true },
    });
    return toMoney((sum._sum.declaredAmount ?? 0).toString());
  }

  private async seniorOn(tx: Tx, lineId: string, businessDate: CalendarDate) {
    const assignment = await tx.lineAssignment.findFirst({
      where: {
        lineId,
        assignmentRole: 'SENIOR',
        ...assignmentInEffectOn(businessDate),
      },
      select: {
        staffProfile: {
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    });
    return assignment
      ? {
          userId: assignment.staffProfile.userId,
          name: assignment.staffProfile.user.name,
        }
      : null;
  }

  private async officeReceivers(tx: Tx, context: RequestContext) {
    const admins = await tx.staffProfile.findMany({
      where: {
        organizationId: context.organizationId,
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { userId: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return admins.map((admin) => ({
      userId: admin.userId,
      name: admin.user.name,
    }));
  }
}

/** All nine denominations, missing ones counted as zero, each with its subtotal. */
function normaliseCounts(counts: HandOverInput['counts']) {
  const seen = new Set<number>();
  for (const row of counts) {
    if (seen.has(row.denomination)) {
      throw new DomainError(
        'DUPLICATE_DENOMINATION',
        `₹${row.denomination} is counted twice`,
        [
          {
            field: 'counts',
            issue: `₹${row.denomination} appears more than once`,
          },
        ],
      );
    }
    seen.add(row.denomination);
  }
  return DENOMINATIONS.map((denomination) => {
    const count =
      counts.find((row) => row.denomination === denomination)?.count ?? 0;
    return {
      denomination,
      count,
      subtotal: toMoney(String(denomination)).times(count),
    };
  });
}

function pendingConflict() {
  return new ConflictError(
    'HANDOVER_PENDING',
    'A handover for this day is already waiting to be acknowledged or disputed',
  );
}
