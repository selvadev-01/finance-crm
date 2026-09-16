import { Injectable } from '@nestjs/common';
import type {
  Approval,
  ApprovalQueueItem,
  CollectionDetail,
  CollectionListItem,
  collectionContract,
  RouteInput,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  fromUtcMidnight,
  parseCalendarDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { roleHasPermission } from '../access/permissions.js';
import { collectionScope, foundInScope, inScope } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ValidationError } from '../platform/errors/errors.js';
import { type Page, pageArgs, toPage } from '../platform/pagination.js';

type ListQuery = RouteInput<typeof collectionContract.listCollections>['query'];

/** S-16 is date-bounded: a quarter at most per request. */
const MAX_RANGE_DAYS = 93;

/** Accounts whose collections may still be corrected. */
export const CORRECTABLE_ACCOUNT = ['ACTIVE', 'COMPLETED'] as const;

export const itemSelect = {
  id: true,
  entryType: true,
  status: true,
  adjustsCollectionId: true,
  accountLoanId: true,
  lineId: true,
  collectedByUserId: true,
  businessDate: true,
  capturedAt: true,
  syncedAt: true,
  expectedAmount: true,
  amount: true,
  variance: true,
  classification: true,
  note: true,
  accountLoan: {
    select: {
      accountCode: true,
      customerId: true,
      status: true,
      outstandingAmount: true,
      customer: { select: { name: true } },
    },
  },
  line: { select: { name: true } },
} satisfies Prisma.CollectionSelect;

export const approvalSelect = {
  id: true,
  decision: true,
  reason: true,
  requestedByUserId: true,
  decidedByUserId: true,
  decisionNote: true,
  decidedAt: true,
  createdAt: true,
} satisfies Prisma.CollectionApprovalSelect;

type ItemRow = Prisma.CollectionGetPayload<{ select: typeof itemSelect }>;
type ApprovalRow = Prisma.CollectionApprovalGetPayload<{
  select: typeof approvalSelect;
}>;

/** Staff names by user id; an unknown id reads as such rather than failing. */
export type Names = (userId: string | null) => string;

/**
 * M07 history (S-16, S-17) and the views corrections share (S-18). Reads only,
 * always through `collectionScope`: Admins see the organisation, a Senior their
 * line, a Junior their own entries; anything else is `404` (M02).
 */
@Injectable()
export class CollectionHistoryService {
  constructor(private readonly database: Database) {}

  async list(
    context: RequestContext,
    query: ListQuery,
  ): Promise<Page<CollectionListItem>> {
    const from = parseCalendarDate(query.from);
    const to = parseCalendarDate(query.to);
    const DAY_MS = 24 * 60 * 60 * 1000;
    const span =
      (toUtcMidnight(to).getTime() - toUtcMidnight(from).getTime()) / DAY_MS;
    if (span < 0 || span >= MAX_RANGE_DAYS) {
      throw new ValidationError(
        'INVALID_DATE_RANGE',
        `Choose a range of up to ${MAX_RANGE_DAYS} days, with "from" on or before "to"`,
        [
          {
            field: 'to',
            issue: `must be 0–${MAX_RANGE_DAYS - 1} days after from`,
          },
        ],
      );
    }
    const rows = await this.database.client.collection.findMany({
      where: inScope(collectionScope(context), {
        businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(to) },
        ...(query.lineId ? { lineId: query.lineId } : {}),
        ...(query.accountLoanId ? { accountLoanId: query.accountLoanId } : {}),
        ...(query.entryType ? { entryType: query.entryType } : {}),
        ...(query.status ? { status: query.status } : {}),
      }),
      select: itemSelect,
      ...pageArgs(query),
    });
    const names = await this.names(rows.map((row) => row.collectedByUserId));
    return toPage(rows, query, (row) => toItem(row, names));
  }

  async get(
    context: RequestContext,
    collectionId: string,
  ): Promise<CollectionDetail> {
    const tx = this.database.client;
    const row = foundInScope(
      await tx.collection.findFirst({
        where: inScope(collectionScope(context), { id: collectionId }),
        select: {
          ...itemSelect,
          approval: { select: approvalSelect },
          adjustedBy: {
            select: { ...itemSelect, approval: { select: approvalSelect } },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      'collection',
    );
    const names = await this.names([
      row.collectedByUserId,
      ...[row, ...row.adjustedBy].flatMap((entry) =>
        entry.approval
          ? [entry.approval.requestedByUserId, entry.approval.decidedByUserId]
          : [],
      ),
    ]);
    const original = row.entryType === 'ORIGINAL';
    const net = netOf(row, row.adjustedBy);
    const pending = row.adjustedBy.some(
      (adjustment) => adjustment.status === 'PENDING_APPROVAL',
    );
    const correctable =
      original &&
      !pending &&
      (CORRECTABLE_ACCOUNT as readonly string[]).includes(
        row.accountLoan.status,
      );

    return {
      ...toItem(row, names),
      approval: row.approval ? toApproval(context, row.approval, names) : null,
      adjustments: row.adjustedBy.map((adjustment) => ({
        ...toItem(adjustment, names),
        approval: adjustment.approval
          ? toApproval(context, adjustment.approval, names)
          : null,
      })),
      netAmount: net.toFixed(2),
      account: {
        status: row.accountLoan.status,
        outstandingAmount: row.accountLoan.outstandingAmount.toFixed(2),
      },
      canRequestCorrection:
        correctable &&
        roleHasPermission(context.role, 'collection.requestCorrection'),
      canReverse:
        correctable &&
        net.greaterThan(0) &&
        roleHasPermission(context.role, 'collection.reverse'),
    };
  }

  /** The S-18 view of one approval, read in the caller's transaction. */
  async queueItem(
    context: RequestContext,
    approvalId: string,
  ): Promise<ApprovalQueueItem> {
    const [item] = await this.queueItems(context, { id: approvalId });
    return foundInScope(item, 'approval');
  }

  async queueItems(
    context: RequestContext,
    where: Prisma.CollectionApprovalWhereInput,
    page?: { cursor?: string | undefined; limit: number },
  ): Promise<ApprovalQueueItem[]> {
    const rows = await this.database.client.collectionApproval.findMany({
      where: { AND: [where, { collection: collectionScope(context) }] },
      select: {
        ...approvalSelect,
        collection: {
          select: {
            ...itemSelect,
            adjusts: {
              select: {
                id: true,
                amount: true,
                businessDate: true,
                classification: true,
                adjustedBy: {
                  where: { status: 'CONFIRMED' },
                  select: { id: true, amount: true },
                },
              },
            },
          },
        },
      },
      ...(page ? pageArgs(page) : { orderBy: { id: 'asc' as const } }),
    });
    const names = await this.names(
      rows.flatMap((row) => [
        row.requestedByUserId,
        row.decidedByUserId,
        row.collection.collectedByUserId,
      ]),
    );
    return rows.map((row) => {
      const adjustment = row.collection;
      const original = adjustment.adjusts!;
      // Confirmed adjustments other than this one: the net it was asked against.
      const before = netOf(
        original,
        original.adjustedBy.filter((other) => other.id !== adjustment.id),
      );
      return {
        ...toApproval(context, row, names),
        adjustment: toItem(adjustment, names),
        original: {
          id: original.id,
          amount: original.amount.toFixed(2),
          businessDate: fromUtcMidnight(original.businessDate),
          classification: original.classification,
          netAmount: before.toFixed(2),
        },
        correctedAmount: before.plus(adjustment.amount.toString()).toFixed(2),
      };
    });
  }

  async names(userIds: (string | null)[]): Promise<Names> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
    const users = ids.length
      ? await this.database.client.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user.name]));
    return (userId) => (userId ? (byId.get(userId) ?? 'Unknown staff') : '');
  }
}

/** The original plus its CONFIRMED adjustments (BR-14). */
export function netOf(
  original: { amount: { toString(): string } },
  adjustments: { amount: { toString(): string }; status?: string }[],
) {
  return adjustments
    .filter((adjustment) => (adjustment.status ?? 'CONFIRMED') === 'CONFIRMED')
    .reduce(
      (sum, adjustment) => sum.plus(adjustment.amount.toString()),
      toMoney(original.amount.toString()),
    );
}

export function toItem(row: ItemRow, names: Names): CollectionListItem {
  return {
    id: row.id,
    entryType: row.entryType,
    status: row.status,
    adjustsCollectionId: row.adjustsCollectionId,
    accountLoanId: row.accountLoanId,
    accountCode: row.accountLoan.accountCode,
    customerId: row.accountLoan.customerId,
    customerName: row.accountLoan.customer.name,
    lineId: row.lineId,
    lineName: row.line.name,
    collectedByUserId: row.collectedByUserId,
    collectedByName: names(row.collectedByUserId),
    businessDate: fromUtcMidnight(row.businessDate),
    capturedAt: row.capturedAt.toISOString(),
    syncedAt: row.syncedAt.toISOString(),
    expectedAmount: row.expectedAmount.toFixed(2),
    amount: row.amount.toFixed(2),
    variance: row.variance.toFixed(2),
    classification: row.classification,
    note: row.note,
  };
}

function toApproval(
  context: RequestContext,
  row: ApprovalRow,
  names: Names,
): Approval {
  return {
    id: row.id,
    decision: row.decision,
    reason: row.reason,
    requestedByUserId: row.requestedByUserId,
    requestedByName: names(row.requestedByUserId),
    requestedAt: row.createdAt.toISOString(),
    decidedByName: row.decidedByUserId ? names(row.decidedByUserId) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    canDecide:
      row.decision === 'PENDING' &&
      row.requestedByUserId !== context.userId &&
      roleHasPermission(context.role, 'collection.approveCorrection'),
  };
}
