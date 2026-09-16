import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  CollectionView,
  collectionContract,
  RouteInput,
} from '@repo/contracts';
import { Prisma } from '@repo/db';
import {
  capExpectedAmount,
  classifyCollection,
  profitForCollection,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { accountScope, foundInScope, inScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  ConflictError,
  DomainError,
  InternalError,
} from '../platform/errors/errors.js';
import { DayCloseService } from '../cash/day-close.service.js';
import { EventNotices } from '../notifications/event-notices.js';
import { AccountSettlement } from './account-settlement.js';

type RecordInput = RouteInput<
  typeof collectionContract.recordCollection
>['body'];

const ENDPOINT = 'POST /api/collections';
/** BR-13: keys are kept 90 days, then purged by a scheduled job (M14). */
const KEY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** A device clock further ahead than this is not believed (decided 2026-09-13). */
const CLOCK_SKEW_MS = 15 * 60 * 1000;

export type RecordResult =
  | { replayed: false; collection: CollectionView }
  | { replayed: true; collection: CollectionView };

/**
 * M07 — recording a collection (US-041), safe to replay (US-053), completing
 * the account on its balance (US-033, BR-05).
 *
 * One transaction does all of it (BR-18): the append-only collection row with
 * its frozen `lineId`, `collectedByUserId`, `expectedAmount` and
 * `businessDate`; the answered slot; the account's cached balances and the
 * regenerated tail (BR-06) or completion; the ledger posting; the audit entry;
 * and the idempotency record holding the response to replay.
 *
 * Decided 2026-09-13:
 * - The collection answers the **earliest pending slot due on or before its
 *   business date**, or else the next pending slot — real cash is never refused
 *   for want of a slot.
 * - A device clock more than 15 minutes ahead is treated as the server's time
 *   and logged; late syncs of past dates are normal and accepted.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
    private readonly logger: PinoLogger,
    private readonly settlement: AccountSettlement,
    private readonly dayCloses: DayCloseService,
    private readonly notices: EventNotices,
  ) {}

  async record(
    context: RequestContext,
    input: RecordInput,
    now: Date = new Date(),
  ): Promise<RecordResult> {
    const earlier = await this.replay(context, input);
    if (earlier) return earlier;
    try {
      return await this.database.transaction(() =>
        this.write(context, input, now),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !this.database.inTransaction
      ) {
        // Two sends of the same key at once: the second waited on the
        // account lock, then lost the unique-key race to the committed first,
        // so it is a replay (BR-13). Any other uniqueness clash is not, and is
        // answered as a conflict to retry, never a raw database error.
        const replay = await this.replay(context, input);
        if (replay) return replay;
        throw new ConflictError(
          'COLLECTION_CONFLICT',
          'The account changed while this collection was being saved. Try again.',
        );
      }
      throw error;
    }
  }

  /**
   * A key already used: the stored response with `200` when it is the same
   * collection, `409` when the key arrives with a different one — a client bug,
   * never something to paper over.
   */
  private async replay(
    context: RequestContext,
    input: RecordInput,
  ): Promise<RecordResult | null> {
    const stored = await this.database.client.idempotencyKey.findUnique({
      where: { key: input.idempotencyKey },
    });
    if (!stored) return null;
    const original = stored.responseBody as unknown as CollectionView;
    const same =
      stored.userId === context.userId &&
      stored.endpoint === ENDPOINT &&
      original.accountLoanId === input.accountLoanId &&
      toMoney(original.amount).equals(toMoney(input.amount)) &&
      new Date(original.capturedAt).getTime() ===
        new Date(input.capturedAt).getTime();
    if (!same) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different collection',
      );
    }
    return { replayed: true, collection: original };
  }

  private async write(
    context: RequestContext,
    input: RecordInput,
    now: Date,
  ): Promise<RecordResult> {
    const tx = this.database.client;
    const inScopeAccount = foundInScope(
      await tx.accountLoan.findFirst({
        where: inScope(accountScope(context), { id: input.accountLoanId }),
        select: { id: true },
      }),
      'account',
    );
    // Serialise every write to this account. Two collections at once would
    // otherwise both read the same outstanding, both pass the check below, and
    // the second's balances and regenerated tail would overwrite the first's.
    // The lock is held to commit; the second write then reads the first's
    // result — and, for a duplicate key, finds the key taken.
    await tx.$queryRaw`SELECT id FROM account_loan WHERE id = ${inScopeAccount.id} FOR UPDATE`;
    const account = foundInScope(
      await tx.accountLoan.findUnique({
        where: { id: inScopeAccount.id },
        select: {
          id: true,
          organizationId: true,
          accountCode: true,
          status: true,
          accountAmount: true,
          profitAmount: true,
          dailyAmount: true,
          collectedAmount: true,
          outstandingAmount: true,
          disbursementDate: true,
          targetCompletionDate: true,
          customer: { select: { lineId: true, sectorId: true, name: true } },
        },
      }),
      'account',
    );
    if (account.status !== 'ACTIVE') {
      throw new DomainError(
        'ACCOUNT_NOT_ACTIVE',
        `Account ${account.accountCode} is ${account.status.toLowerCase()}; collections are recorded only on an active account`,
      );
    }

    const captured = new Date(input.capturedAt);
    const believed =
      captured.getTime() - now.getTime() > CLOCK_SKEW_MS ? now : captured;
    if (believed !== captured) {
      this.logger.warn(
        { idempotencyKey: input.idempotencyKey, userId: context.userId },
        'Collection captured ahead of server time; business date taken from server time',
      );
    }
    const businessDate = toBusinessDate(believed);

    const amount = toMoney(input.amount);
    const outstanding = toMoney(account.outstandingAmount.toString());
    if (amount.greaterThan(outstanding)) {
      throw new DomainError(
        'AMOUNT_EXCEEDS_OUTSTANDING',
        `The outstanding on ${account.accountCode} is ₹${outstanding.toFixed(2)}; a collection cannot be more than that`,
        [
          {
            field: 'amount',
            issue: `must be at most ${outstanding.toFixed(2)}`,
          },
        ],
      );
    }

    const day = toUtcMidnight(businessDate);
    const slot =
      (await tx.accountSchedule.findFirst({
        where: {
          accountLoanId: account.id,
          // A slot marked MISSED at day close is answered by the late
          // collection that was taken that day (US-043).
          status: { in: ['PENDING', 'MISSED'] },
          dueDate: { lte: day },
        },
        orderBy: { sequence: 'asc' },
      })) ??
      (await tx.accountSchedule.findFirst({
        where: { accountLoanId: account.id, status: 'PENDING' },
        orderBy: { sequence: 'asc' },
      }));
    if (!slot) {
      throw new InternalError(
        'ACTIVE_ACCOUNT_WITHOUT_PENDING_SLOT',
        `Account ${account.accountCode} is active with nothing scheduled`,
      );
    }

    const D = toMoney(account.dailyAmount.toString());
    const expected = capExpectedAmount(D, outstanding);
    const { variance, classification } = classifyCollection({
      amount,
      expectedAmount: expected,
    });

    const collection = await tx.collection.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        accountLoanId: account.id,
        accountScheduleId: slot.id,
        lineId: account.customer.lineId,
        collectedByUserId: context.userId,
        businessDate: day,
        capturedAt: captured,
        syncedAt: now,
        expectedAmount: expected.toFixed(2),
        amount: amount.toFixed(2),
        variance: variance.toFixed(2),
        classification,
        note: input.note ?? null,
        createdByUserId: context.userId,
      },
    });

    await tx.accountSchedule.update({
      where: { id: slot.id },
      data: {
        status:
          amount.greaterThanOrEqualTo(expected) && amount.greaterThan(0)
            ? 'COLLECTED'
            : 'PARTIAL',
      },
    });

    // Balances, then completion (US-033, BR-05) or the regenerated tail
    // (BR-06); answered slots are never touched.
    const updated = await this.settlement.settle(
      context,
      account,
      amount,
      businessDate,
    );
    const { collectedBefore } = updated;
    const completedOn = updated.actualCompletionDate;

    if (amount.greaterThan(0)) {
      const cash = await this.ledger.cashInHand(
        account.organizationId,
        context.userId,
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
      const profit = profitForCollection({
        accountAmount: account.accountAmount.toString(),
        profitAmount: account.profitAmount.toString(),
        collectedBefore,
        amount,
      });
      await this.ledger.post(context, {
        transactionType: 'COLLECTION',
        source: { table: 'collection', id: collection.id },
        businessDate,
        eventAt: captured,
        description: `Collection ${account.accountCode}`,
        lines: [
          {
            ledgerAccountId: cash,
            direction: 'DEBIT',
            amount: amount.toFixed(2),
          },
          {
            ledgerAccountId: receivable,
            direction: 'CREDIT',
            amount: amount.toFixed(2),
          },
          {
            ledgerAccountId: unearned,
            direction: 'DEBIT',
            amount: profit.toFixed(2),
          },
          {
            ledgerAccountId: earned,
            direction: 'CREDIT',
            amount: profit.toFixed(2),
          },
        ],
      });
    }

    // US-072: the line's Senior hears of a low, extra or no-payment visit, and
    // of a completed account, in this transaction.
    await this.notices.collectionRecorded({
      actorUserId: context.userId,
      collectionId: collection.id,
      accountLoanId: account.id,
      lineId: account.customer.lineId,
      accountCode: account.accountCode,
      customerName: account.customer.name,
      classification,
      amount: amount.toFixed(2),
      expectedAmount: expected.toFixed(2),
      completed: completedOn !== null,
    });

    // BR-16a: a collection for a closed day reopens it.
    await this.dayCloses.moneyWritten(
      context,
      account.customer.lineId,
      businessDate,
    );

    await this.audit.record(context, {
      action: 'CREATE',
      entityTable: 'collection',
      entityId: collection.id,
      after: {
        accountLoanId: account.id,
        amount: amount.toFixed(2),
        classification,
        businessDate,
        ...(completedOn ? { completedAccount: true } : {}),
      },
    });

    const view: CollectionView = {
      id: collection.id,
      idempotencyKey: collection.idempotencyKey,
      accountLoanId: account.id,
      accountScheduleId: slot.id,
      lineId: collection.lineId,
      collectedByUserId: collection.collectedByUserId,
      businessDate,
      capturedAt: collection.capturedAt.toISOString(),
      syncedAt: collection.syncedAt.toISOString(),
      expectedAmount: expected.toFixed(2),
      amount: amount.toFixed(2),
      variance: variance.toFixed(2),
      classification,
      note: collection.note,
      account: {
        status: updated.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
        collectedAmount: updated.collectedAmount.toFixed(2),
        outstandingAmount: updated.outstandingAmount.toFixed(2),
        targetCompletionDate: updated.targetCompletionDate,
        actualCompletionDate: updated.actualCompletionDate,
      },
    };

    await tx.idempotencyKey.create({
      data: {
        key: input.idempotencyKey,
        userId: context.userId,
        endpoint: ENDPOINT,
        responseBody: view as unknown as Prisma.InputJsonValue,
        responseStatus: 201,
        expiresAt: new Date(now.getTime() + KEY_RETENTION_MS),
      },
    });

    return { replayed: false, collection: view };
  }
}
