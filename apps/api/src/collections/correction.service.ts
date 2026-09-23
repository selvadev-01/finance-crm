import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  ApprovalQueueItem,
  collectionContract,
  RouteInput,
} from '@repo/contracts';
import { Prisma } from '@repo/db';
import {
  classifyCollection,
  fromUtcMidnight,
  profitForCollection,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { collectionScope, foundInScope, inScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
} from '../platform/errors/errors.js';
import { type Page, type PageRequest, toPage } from '../platform/pagination.js';
import { DayCloseService } from '../cash/day-close.service.js';
import { EventNotices } from '../notifications/event-notices.js';
import { AccountSettlement } from './account-settlement.js';
import {
  CollectionHistoryService,
  CORRECTABLE_ACCOUNT,
  maySelfApprove,
  netOf,
} from './collection-history.service.js';

type DecideInput = {
  decision: RouteInput<
    typeof collectionContract.decideApproval
  >['body']['decision'];
  note?: string | undefined;
};

/**
 * M07 corrections (US-044, BR-14). A recorded collection is never changed:
 * a correction is a new `ADJUSTMENT` row for the difference, waiting as
 * `PENDING_APPROVAL` and moving nothing until someone else approves it.
 *
 * - **Request:** a Junior for their own entries, a Senior for their line; an
 *   Admin **reverses** instead (a correction to ₹0). One pending correction per
 *   collection, enforced by the database.
 * - **Approve:** a Senior for their line, or an Admin — never the requester
 *   (self-approval is blocked regardless of role). In one transaction under
 *   the account lock: the status, the balances with completion, a regenerated
 *   tail or reopening ({@link AccountSettlement}), the ADJUSTMENT ledger
 *   posting, and the audit entry.
 * - **Reject:** the adjustment ends `REJECTED`; nothing moves; both rows stay.
 *
 * Decided 2026-09-14: the adjustment carries the business date it was
 * **requested** (the row is frozen at insert); its tail is regenerated from the
 * **approval** date; it moves the original collector's `CASH_IN_HAND`.
 */
@Injectable()
export class CorrectionService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
    private readonly settlement: AccountSettlement,
    private readonly history: CollectionHistoryService,
    private readonly dayCloses: DayCloseService,
    private readonly notices: EventNotices,
  ) {}

  /** US-044: ask for a collection's net to become `correctedAmount`. */
  request(
    context: RequestContext,
    collectionId: string,
    input: { correctedAmount: string; reason: string },
    now: Date = new Date(),
  ): Promise<ApprovalQueueItem> {
    return this.requestChange(context, collectionId, input, 'CORRECTION', now);
  }

  /** BR-14: a reversal is a correction to ₹0, requested by an Admin. */
  reverse(
    context: RequestContext,
    collectionId: string,
    input: { reason: string },
    now: Date = new Date(),
  ): Promise<ApprovalQueueItem> {
    return this.requestChange(
      context,
      collectionId,
      { correctedAmount: '0', reason: input.reason },
      'REVERSAL',
      now,
    );
  }

  async listApprovals(
    context: RequestContext,
    query: PageRequest & { decision: 'PENDING' | 'APPROVED' | 'REJECTED' },
  ): Promise<Page<ApprovalQueueItem>> {
    // One filter for both reads — the queue's rows and how many there are —
    // and `queueItems`/`countQueueItems` put the same scope predicate on it.
    const where = { decision: query.decision };
    const [items, total] = await Promise.all([
      this.history.queueItems(context, where, query),
      this.history.countQueueItems(context, where),
    ]);
    return toPage(items, query, (item) => item, total);
  }

  private async requestChange(
    context: RequestContext,
    collectionId: string,
    input: { correctedAmount: string; reason: string },
    kind: 'CORRECTION' | 'REVERSAL',
    now: Date,
  ): Promise<ApprovalQueueItem> {
    try {
      return await this.database.transaction(async (tx) => {
        const original = foundInScope(
          await tx.collection.findFirst({
            where: inScope(collectionScope(context), { id: collectionId }),
            select: {
              id: true,
              entryType: true,
              accountLoanId: true,
              lineId: true,
              collectedByUserId: true,
              expectedAmount: true,
              amount: true,
            },
          }),
          'collection',
        );
        if (original.entryType !== 'ORIGINAL') {
          throw new DomainError(
            'NOT_AN_ORIGINAL_COLLECTION',
            'Correct the collection as recorded, not one of its adjustments',
          );
        }
        await this.lockAccount(tx, original.accountLoanId);
        const account = await tx.accountLoan.findUniqueOrThrow({
          where: { id: original.accountLoanId },
          select: {
            accountCode: true,
            status: true,
            outstandingAmount: true,
            customer: { select: { name: true } },
          },
        });
        this.assertCorrectable(account);

        const adjustments = await tx.collection.findMany({
          where: { adjustsCollectionId: original.id },
          select: { amount: true, status: true },
        });
        if (adjustments.some((row) => row.status === 'PENDING_APPROVAL')) {
          throw pendingConflict();
        }
        const net = netOf(original, adjustments);
        const corrected = toMoney(input.correctedAmount);
        const change = corrected.minus(net);
        if (change.isZero()) {
          throw new DomainError(
            'NO_CHANGE',
            kind === 'REVERSAL'
              ? 'This collection already stands at ₹0; there is nothing to reverse'
              : `This collection already stands at ₹${net.toFixed(2)}`,
            [
              {
                field: 'correctedAmount',
                issue: `must differ from ${net.toFixed(2)}`,
              },
            ],
          );
        }
        this.assertWithinOutstanding(account, change);

        // An adjustment is not measured against a slot: expected 0, variance
        // equal to its amount. Its classification is how the corrected
        // collection now reads against what was expected that day (BR-08).
        const { classification } = classifyCollection({
          amount: corrected,
          expectedAmount: original.expectedAmount.toString(),
        });
        const adjustment = await tx.collection.create({
          data: {
            idempotencyKey: randomUUID(),
            accountLoanId: original.accountLoanId,
            lineId: original.lineId,
            collectedByUserId: original.collectedByUserId,
            businessDate: toUtcMidnight(toBusinessDate(now)),
            capturedAt: now,
            syncedAt: now,
            expectedAmount: '0.00',
            amount: change.toFixed(2),
            variance: change.toFixed(2),
            classification,
            entryType: 'ADJUSTMENT',
            adjustsCollectionId: original.id,
            status: 'PENDING_APPROVAL',
            createdByUserId: context.userId,
          },
        });
        const approval = await tx.collectionApproval.create({
          data: {
            collectionId: adjustment.id,
            requestedByUserId: context.userId,
            reason: input.reason,
            createdByUserId: context.userId,
          },
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'collection',
          entityId: adjustment.id,
          after: {
            kind,
            adjustsCollectionId: original.id,
            amount: change.toFixed(2),
            correctedAmount: corrected.toFixed(2),
            reason: input.reason,
            approvalId: approval.id,
          },
        });
        await this.notices.correctionRequested({
          actorUserId: context.userId,
          organizationId: context.organizationId,
          lineId: original.lineId,
          accountCode: account.accountCode,
          customerName: account.customer.name,
          from: net.toFixed(2),
          to: corrected.toFixed(2),
          reversal: kind === 'REVERSAL',
        });
        return this.history.queueItem(context, approval.id);
      });
    } catch (error) {
      // Two requests at once: the loser trips the one-pending index.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw pendingConflict();
      }
      throw error;
    }
  }

  async decide(
    context: RequestContext,
    approvalId: string,
    input: DecideInput,
    now: Date = new Date(),
  ): Promise<ApprovalQueueItem> {
    return this.database.transaction(async (tx) => {
      const found = foundInScope(
        await tx.collectionApproval.findFirst({
          where: { id: approvalId, collection: collectionScope(context) },
          select: {
            id: true,
            requestedByUserId: true,
            collection: { select: { accountLoanId: true } },
          },
        }),
        'approval',
      );
      if (
        found.requestedByUserId === context.userId &&
        !maySelfApprove(context)
      ) {
        throw new AuthorizationError(
          'SELF_APPROVAL',
          'You asked for this correction, so someone else must decide it',
        );
      }
      // Serialise with collections and other decisions on this account, then
      // read the decision again: a second approver waits here and finds it taken.
      await this.lockAccount(tx, found.collection.accountLoanId);
      const approval = await tx.collectionApproval.findUniqueOrThrow({
        where: { id: found.id },
        select: {
          decision: true,
          collection: {
            select: {
              id: true,
              amount: true,
              businessDate: true,
              collectedByUserId: true,
              adjustsCollectionId: true,
              lineId: true,
            },
          },
        },
      });
      if (approval.decision !== 'PENDING') {
        throw new ConflictError(
          'APPROVAL_ALREADY_DECIDED',
          `This correction was already ${approval.decision.toLowerCase()}`,
        );
      }
      const adjustment = approval.collection;

      if (input.decision === 'APPROVED') {
        await this.apply(context, adjustment, now);
      }
      await tx.collection.update({
        where: { id: adjustment.id },
        data: {
          status: input.decision === 'APPROVED' ? 'CONFIRMED' : 'REJECTED',
        },
      });
      await tx.collectionApproval.update({
        where: { id: found.id },
        data: {
          decision: input.decision,
          decidedByUserId: context.userId,
          decidedAt: now,
          decisionNote: input.note ?? null,
        },
      });
      await this.audit.record(context, {
        action: input.decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
        entityTable: 'collection',
        entityId: adjustment.id,
        before: { status: 'PENDING_APPROVAL' },
        after: {
          status: input.decision === 'APPROVED' ? 'CONFIRMED' : 'REJECTED',
          approvalId: found.id,
          ...(input.note ? { note: input.note } : {}),
        },
      });
      return this.history.queueItem(context, found.id);
    });
  }

  /** The money half of an approval. The caller holds the account lock. */
  private async apply(
    context: RequestContext,
    adjustment: {
      id: string;
      amount: { toString(): string };
      businessDate: Date;
      collectedByUserId: string;
      adjustsCollectionId: string | null;
      lineId: string;
    },
    now: Date,
  ): Promise<void> {
    const tx = this.database.client;
    const original = await tx.collection.findUniqueOrThrow({
      where: { id: adjustment.adjustsCollectionId! },
      select: { accountLoanId: true },
    });
    const account = await tx.accountLoan.findUniqueOrThrow({
      where: { id: original.accountLoanId },
      select: {
        id: true,
        organizationId: true,
        accountCode: true,
        status: true,
        accountAmount: true,
        profitAmount: true,
        dailyAmount: true,
        collectionFrequency: true,
        collectedAmount: true,
        outstandingAmount: true,
        targetCompletionDate: true,
        customer: { select: { sectorId: true } },
      },
    });
    this.assertCorrectable(account);
    const change = toMoney(adjustment.amount.toString());
    // The outstanding may have fallen since the request: checked again here.
    this.assertWithinOutstanding(account, change);

    const { collectedBefore } = await this.settlement.settle(
      context,
      account,
      change,
      toBusinessDate(now),
    );

    const profit = profitForCollection({
      accountAmount: account.accountAmount.toString(),
      profitAmount: account.profitAmount.toString(),
      collectedBefore,
      amount: change,
    });
    // Money back into the collector's hand is a debit; out of it, a credit.
    const into = change.greaterThan(0);
    const cash = await this.ledger.cashInHand(
      account.organizationId,
      adjustment.collectedByUserId,
    );
    const receivable = await this.ledger.receivableFor(account.id);
    const unearned = await this.ledger.organizationAccount(
      account.organizationId,
      'UNEARNED_PROFIT',
    );
    const earned = await this.ledger.organizationAccount(
      account.organizationId,
      'EARNED_PROFIT',
    );
    await this.ledger.post(context, {
      transactionType: 'ADJUSTMENT',
      source: { table: 'collection', id: adjustment.id },
      businessDate: fromUtcMidnight(adjustment.businessDate),
      eventAt: now,
      description: `Correction ${account.accountCode}`,
      lines: [
        {
          ledgerAccountId: cash,
          direction: into ? 'DEBIT' : 'CREDIT',
          amount: change.abs().toFixed(2),
        },
        {
          ledgerAccountId: receivable,
          direction: into ? 'CREDIT' : 'DEBIT',
          amount: change.abs().toFixed(2),
        },
        {
          ledgerAccountId: unearned,
          direction: into ? 'DEBIT' : 'CREDIT',
          amount: profit.abs().toFixed(2),
        },
        {
          ledgerAccountId: earned,
          direction: into ? 'CREDIT' : 'DEBIT',
          amount: profit.abs().toFixed(2),
        },
      ],
    });
    // BR-16a: the adjustment's day, if closed, reopens with the new figure.
    await this.dayCloses.moneyWritten(
      context,
      adjustment.lineId,
      fromUtcMidnight(adjustment.businessDate),
    );
  }

  private async lockAccount(
    tx: Prisma.TransactionClient,
    accountLoanId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM account_loan WHERE id = ${accountLoanId} FOR UPDATE`;
  }

  private assertCorrectable(account: { accountCode: string; status: string }) {
    if (!(CORRECTABLE_ACCOUNT as readonly string[]).includes(account.status)) {
      throw new DomainError(
        'ACCOUNT_NOT_CORRECTABLE',
        `Account ${account.accountCode} is ${account.status.toLowerCase().replace('_', ' ')}; its collections can no longer be corrected`,
      );
    }
  }

  private assertWithinOutstanding(
    account: { accountCode: string; outstandingAmount: { toString(): string } },
    change: ReturnType<typeof toMoney>,
  ) {
    const outstanding = toMoney(account.outstandingAmount.toString());
    if (change.greaterThan(outstanding)) {
      throw new DomainError(
        'AMOUNT_EXCEEDS_OUTSTANDING',
        `The outstanding on ${account.accountCode} is ₹${outstanding.toFixed(2)}; a correction cannot add more than that`,
        [
          {
            field: 'correctedAmount',
            issue: `adds more than ${outstanding.toFixed(2)}`,
          },
        ],
      );
    }
  }
}

function pendingConflict() {
  return new ConflictError(
    'CORRECTION_PENDING',
    'A correction of this collection is already waiting for approval',
  );
}
