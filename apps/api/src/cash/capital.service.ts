import { Injectable } from '@nestjs/common';
import type { CapitalEntry, CapitalPage } from '@repo/contracts';
import {
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { capitalScope, inScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import { decodeCursor, encodeCursor } from '../platform/pagination.js';

const capitalFields = {
  id: true,
  amount: true,
  businessDate: true,
  note: true,
  createdAt: true,
  createdByUserId: true,
} as const;

type CapitalRow = {
  id: string;
  amount: { toFixed(places: number): string };
  businessDate: Date;
  note: string;
  createdAt: Date;
  createdByUserId: string;
};

/**
 * US-032 (decided 2026-09-24): money the owner puts into the business. Each
 * entry and its posting — debit `CASH_AT_OFFICE`, credit `CAPITAL` — commit
 * together (BR-18), audited, so office cash is funded rather than running
 * negative as accounts are disbursed (M09). Entries are append-only in the
 * database; a mistake is answered by a later entry.
 */
@Injectable()
export class CapitalService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
  ) {}

  async add(
    context: RequestContext,
    input: { amount: string; businessDate?: string | undefined; note: string },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<CapitalEntry> {
    const businessDate = input.businessDate
      ? parseCalendarDate(input.businessDate)
      : today;
    if (businessDate > today) {
      throw new DomainError(
        'CAPITAL_DATE_IN_FUTURE',
        'Capital is recorded on the day the money arrived, which cannot be in the future',
        [{ field: 'businessDate', issue: 'is in the future' }],
      );
    }
    const amount = toMoney(input.amount).toFixed(2);

    return this.database.transaction(async (tx) => {
      const row = await tx.capitalEntry.create({
        data: {
          organizationId: context.organizationId,
          amount,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          createdByUserId: context.userId,
        },
        select: capitalFields,
      });

      const officeCash = await this.ledger.organizationAccount(
        context.organizationId,
        'CASH_AT_OFFICE',
      );
      const capital = await this.ledger.organizationAccount(
        context.organizationId,
        'CAPITAL',
      );
      await this.ledger.post(context, {
        transactionType: 'CAPITAL',
        source: { table: 'capital_entry', id: row.id },
        businessDate,
        eventAt: new Date(),
        description: `Capital introduced: ${input.note}`,
        lines: [
          { ledgerAccountId: officeCash, direction: 'DEBIT', amount },
          { ledgerAccountId: capital, direction: 'CREDIT', amount },
        ],
      });

      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'capital_entry',
        entityId: row.id,
        after: { amount, businessDate, note: input.note },
      });

      const names = await this.names([row]);
      return toEntry(row, names);
    });
  }

  /** Newest first, with the total ever put in and office cash now. */
  async list(
    context: RequestContext,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<CapitalPage> {
    const tx = this.database.client;
    const where = inScope(capitalScope(context));
    const [rows, total, sum, office] = await Promise.all([
      tx.capitalEntry.findMany({
        where,
        select: capitalFields,
        // (createdAt, id) is a total order, so a page never repeats a row.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
        ...(page.cursor
          ? { cursor: { id: decodeCursor(page.cursor) }, skip: 1 }
          : {}),
      }),
      tx.capitalEntry.count({ where }),
      tx.capitalEntry.aggregate({ where, _sum: { amount: true } }),
      tx.ledgerAccount.findFirst({
        where: {
          organizationId: context.organizationId,
          accountType: 'CASH_AT_OFFICE',
        },
        select: { balance: true },
      }),
    ]);
    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const names = await this.names(visible);
    return {
      data: visible.map((row) => toEntry(row, names)),
      nextCursor:
        hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
      hasMore,
      total,
      totalCapital: toMoney((sum._sum.amount ?? 0).toString()).toFixed(2),
      officeCash: toMoney((office?.balance ?? 0).toString()).toFixed(2),
    };
  }

  private async names(rows: CapitalRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.createdByUserId))];
    if (ids.length === 0) return new Map();
    const users = await this.database.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function toEntry(row: CapitalRow, names: Map<string, string>): CapitalEntry {
  const name = names.get(row.createdByUserId);
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    businessDate: fromUtcMidnight(row.businessDate),
    note: row.note,
    addedBy: name ? { userId: row.createdByUserId, name } : null,
    createdAt: row.createdAt.toISOString(),
  };
}
