import { Injectable } from '@nestjs/common';
import type { LedgerTransactionView } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  fromUtcMidnight,
  parseCalendarDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { seesOrganizationLedger } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  decodeCursor,
  encodeCursor,
  type Page,
} from '../platform/pagination.js';

const transactionFields = {
  id: true,
  transactionType: true,
  businessDate: true,
  eventAt: true,
  description: true,
  sourceTable: true,
  sourceId: true,
  createdByUserId: true,
  entries: {
    orderBy: { sequence: 'asc' },
    select: {
      direction: true,
      amount: true,
      ledgerAccount: {
        select: {
          accountType: true,
          ownerUserId: true,
          accountLoanId: true,
          accountLoan: { select: { accountCode: true } },
          expenseCategory: { select: { name: true } },
          bankAccount: { select: { name: true } },
        },
      },
    },
  },
} as const satisfies Prisma.LedgerTransactionSelect;

type Row = Prisma.LedgerTransactionGetPayload<{
  select: typeof transactionFields;
}>;

/**
 * M09 "view transactions and entries" (Admin+): every posting over a date
 * range, newest first, each with its entries. A transaction carries no
 * organization of its own, so it is the organization's when its entries
 * post to the organization's ledger accounts. Read-only.
 */
@Injectable()
export class LedgerTransactionsService {
  constructor(private readonly database: Database) {}

  async list(
    context: RequestContext,
    query: {
      from: string;
      to: string;
      type?: LedgerTransactionView['transactionType'] | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<Page<LedgerTransactionView>> {
    if (!seesOrganizationLedger(context)) {
      return { data: [], nextCursor: null, hasMore: false, total: 0 };
    }
    const where: Prisma.LedgerTransactionWhereInput = {
      entries: {
        some: { ledgerAccount: { organizationId: context.organizationId } },
      },
      businessDate: {
        gte: toUtcMidnight(parseCalendarDate(query.from)),
        lte: toUtcMidnight(parseCalendarDate(query.to)),
      },
      ...(query.type ? { transactionType: query.type } : {}),
    };
    const tx = this.database.client;
    const [rows, total] = await Promise.all([
      tx.ledgerTransaction.findMany({
        where,
        select: transactionFields,
        // (businessDate, createdAt, id) is a total order: no page repeats a row.
        orderBy: [
          { businessDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }
          : {}),
      }),
      tx.ledgerTransaction.count({ where }),
    ]);
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const names = await this.names(visible);
    return {
      data: visible.map((row) => toView(row, names)),
      nextCursor:
        hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
      hasMore,
      total,
    };
  }

  private async names(rows: Row[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.createdByUserId) ids.add(row.createdByUserId);
      for (const entry of row.entries) {
        if (entry.ledgerAccount.ownerUserId)
          ids.add(entry.ledgerAccount.ownerUserId);
      }
    }
    if (ids.size === 0) return new Map();
    const users = await this.database.client.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function toView(row: Row, names: Map<string, string>): LedgerTransactionView {
  const entries = row.entries
    .map((entry) => ({
      accountType: entry.ledgerAccount.accountType,
      ownerName: entry.ledgerAccount.ownerUserId
        ? (names.get(entry.ledgerAccount.ownerUserId) ?? null)
        : null,
      referenceName:
        entry.ledgerAccount.expenseCategory?.name ??
        entry.ledgerAccount.bankAccount?.name ??
        null,
      accountLoanId: entry.ledgerAccount.accountLoanId,
      accountCode: entry.ledgerAccount.accountLoan?.accountCode ?? null,
      direction: entry.direction,
      amount: entry.amount.toFixed(2),
    }))
    // Debits first, then credits; each side keeps the posting's order.
    .sort(
      (a, b) =>
        Number(a.direction === 'CREDIT') - Number(b.direction === 'CREDIT'),
    );
  const amount = entries
    .filter((entry) => entry.direction === 'DEBIT')
    .reduce((sum, entry) => sum.plus(entry.amount), toMoney('0'));
  return {
    id: row.id,
    transactionType: row.transactionType,
    businessDate: fromUtcMidnight(row.businessDate),
    eventAt: row.eventAt.toISOString(),
    description: row.description,
    sourceTable: row.sourceTable,
    sourceId: row.sourceId,
    createdByName: row.createdByUserId
      ? (names.get(row.createdByUserId) ?? null)
      : null,
    entries,
    amount: amount.toFixed(2),
  };
}
