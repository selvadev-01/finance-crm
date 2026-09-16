import { Injectable } from '@nestjs/common';
import type {
  AccountHistoryEvent,
  auditContract,
  RouteSuccess,
} from '@repo/contracts';
import { fromUtcMidnight, toMoney } from '@repo/domain';

import { accountScope, foundInScope, inScope } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  auditRowSelect,
  person,
  toAuditEntry,
  userNames,
} from './audit-log.service.js';

type History = RouteSuccess<typeof auditContract.getAccountHistory>;

const money = (value: { toString(): string }) =>
  toMoney(value.toString()).toFixed(2);

/** Same instant: the audit entry of an action reads before what it produced. */
const KIND_ORDER: Record<AccountHistoryEvent['kind'], number> = {
  AUDIT: 0,
  COLLECTION: 1,
  DAY_CLOSE: 2,
};

/**
 * US-091 — an account's full chronological trail, the screen an Admin opens
 * when a customer disputes a figure (M13). Assembled from three records, none
 * of them changed here:
 *
 * - **Audit entries** for the account (creation, disbursement, reconciliation
 *   findings) and the approve / reject decisions on its corrections. Matched by
 *   entity id, which belongs to this account, so entries written before audit
 *   rows carried an organization are included.
 * - **Collections**, original and adjustment, with the collector, variance and
 *   any approval — the collection rows are their own history (BR-14).
 * - **Day closes** of the lines and dates its collections fell on, with their
 *   own audit entries (close, reopen), since the row keeps only its latest state.
 *
 * Completion is the account's status and date, and the collection that
 * completed it is in the trail.
 */
@Injectable()
export class AccountHistoryService {
  constructor(private readonly database: Database) {}

  async history(context: RequestContext, accountId: string): Promise<History> {
    const tx = this.database.client;
    const account = foundInScope(
      await tx.accountLoan.findFirst({
        where: inScope(accountScope(context), { id: accountId }),
        select: {
          id: true,
          accountCode: true,
          status: true,
          actualCompletionDate: true,
          customer: { select: { name: true } },
        },
      }),
      'account',
    );

    const collections = await tx.collection.findMany({
      // Scoped twice over: the account is in scope, and so is its organization.
      where: {
        accountLoanId: account.id,
        accountLoan: { organizationId: context.organizationId },
      },
      select: {
        id: true,
        createdAt: true,
        businessDate: true,
        entryType: true,
        adjustsCollectionId: true,
        amount: true,
        expectedAmount: true,
        variance: true,
        classification: true,
        status: true,
        collectedByUserId: true,
        lineId: true,
        note: true,
        approval: {
          select: {
            decision: true,
            reason: true,
            requestedByUserId: true,
            decidedByUserId: true,
            decisionNote: true,
            decidedAt: true,
          },
        },
      },
    });

    const dayKeys = new Map<string, { lineId: string; businessDate: Date }>();
    for (const collection of collections) {
      dayKeys.set(
        `${collection.lineId}:${collection.businessDate.toISOString()}`,
        {
          lineId: collection.lineId,
          businessDate: collection.businessDate,
        },
      );
    }
    const dayCloses =
      dayKeys.size === 0
        ? []
        : await tx.dayClose.findMany({
            where: {
              OR: [...dayKeys.values()],
              line: { organizationId: context.organizationId },
            },
            select: {
              id: true,
              lineId: true,
              businessDate: true,
              status: true,
              expectedTotal: true,
              collectedTotal: true,
              discrepancy: true,
              closedByUserId: true,
              closedAt: true,
              updatedAt: true,
              reopenReason: true,
              line: { select: { name: true } },
            },
          });

    const audits = await tx.auditLog.findMany({
      where: {
        OR: [
          { entityTable: 'account_loan', entityId: account.id },
          {
            entityTable: 'collection',
            entityId: { in: collections.map((collection) => collection.id) },
            action: { in: ['APPROVE', 'REJECT'] },
          },
          // Closes, re-closes and reopens of those days: the current day_close
          // row shows only its latest state, so a reopen is visible only here.
          {
            entityTable: 'day_close',
            entityId: { in: dayCloses.map((close) => close.id) },
          },
        ],
      },
      select: auditRowSelect,
    });

    const names = await userNames(tx, [
      ...audits.map((row) => row.actorUserId),
      ...collections.flatMap((collection) => [
        collection.collectedByUserId,
        collection.approval?.requestedByUserId,
        collection.approval?.decidedByUserId,
      ]),
      ...dayCloses.map((close) => close.closedByUserId),
    ]);

    const events: AccountHistoryEvent[] = [
      ...audits.map((row): AccountHistoryEvent => ({
        kind: 'AUDIT',
        at: row.createdAt.toISOString(),
        entry: toAuditEntry(row, names),
      })),
      ...collections.map((collection): AccountHistoryEvent => ({
        kind: 'COLLECTION',
        at: collection.createdAt.toISOString(),
        collectionId: collection.id,
        businessDate: fromUtcMidnight(collection.businessDate),
        entryType: collection.entryType,
        adjustsCollectionId: collection.adjustsCollectionId,
        amount: money(collection.amount),
        expectedAmount: money(collection.expectedAmount),
        variance: money(collection.variance),
        classification: collection.classification,
        status: collection.status,
        collector: person(names, collection.collectedByUserId),
        note: collection.note,
        approval: collection.approval
          ? {
              decision: collection.approval.decision,
              reason: collection.approval.reason,
              requestedBy: person(names, collection.approval.requestedByUserId),
              decidedBy: collection.approval.decidedByUserId
                ? person(names, collection.approval.decidedByUserId)
                : null,
              decisionNote: collection.approval.decisionNote,
              decidedAt: collection.approval.decidedAt?.toISOString() ?? null,
            }
          : null,
      })),
      ...dayCloses.map((close): AccountHistoryEvent => ({
        kind: 'DAY_CLOSE',
        at: (close.closedAt ?? close.updatedAt).toISOString(),
        businessDate: fromUtcMidnight(close.businessDate),
        lineId: close.lineId,
        lineName: close.line.name,
        status: close.status,
        expectedTotal: money(close.expectedTotal),
        collectedTotal: money(close.collectedTotal),
        discrepancy: money(close.discrepancy),
        closedBy: close.closedByUserId
          ? person(names, close.closedByUserId)
          : null,
        reopenReason: close.reopenReason,
      })),
    ];
    events.sort(
      (a, b) =>
        a.at.localeCompare(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );

    return {
      account: {
        id: account.id,
        accountCode: account.accountCode,
        customerName: account.customer.name,
        status: account.status,
        actualCompletionDate: account.actualCompletionDate
          ? fromUtcMidnight(account.actualCompletionDate)
          : null,
      },
      events,
    };
  }
}
