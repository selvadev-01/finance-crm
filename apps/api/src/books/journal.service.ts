import { Injectable } from '@nestjs/common';
import type { JournalEntry, JournalLineInput } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { booksScope, inScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import {
  BooksMoneyService,
  dateRange,
  newestFirst,
  notInFuture,
  pageOf,
} from './books-money.service.js';

type Tx = Database['client'];
type JournalType = JournalLineInput['accountType'];

/** The organization's singleton accounts a journal may name. */
const SINGLETON: Record<
  Exclude<JournalType, 'BANK' | 'EXPENSE'>,
  { type: Parameters<LedgerService['organizationAccount']>[1]; name: string }
> = {
  CASH_AT_OFFICE: { type: 'CASH_AT_OFFICE', name: 'Cash in hand' },
  OTHER_INCOME: { type: 'OTHER_INCOME', name: 'Other income' },
  CAPITAL: { type: 'CAPITAL', name: 'Capital' },
  OWNER_DRAWINGS: { type: 'OWNER_DRAWINGS', name: 'Owner drawings' },
  WRITE_OFF_LOSS: { type: 'WRITE_OFF_LOSS', name: 'Write-off loss' },
};

/** The account types a journal reads back; anything else was not a journal's. */
const JOURNAL_TYPES = new Set<string>([
  'CASH_AT_OFFICE',
  'BANK',
  'EXPENSE',
  'OTHER_INCOME',
  'CAPITAL',
  'OWNER_DRAWINGS',
  'WRITE_OFF_LOSS',
]);

/**
 * Books slice 5 (ADR-0018): the Super Admin's manual journal. One
 * `journal_entry` header and one `JOURNAL` ledger transaction with its
 * balanced lines, written with the audit entry in one transaction.
 *
 * The accounts are the business's own — office cash, a bank, an expense
 * category, other income, capital, drawings, write-off loss — named by type
 * and, for a bank or category, its id; the contract cannot even express cash
 * in hand, a receivable or profit, which the nightly reconciliation holds to
 * the loan book (US-095). A retired bank or category is refused, as it is for
 * every other entry.
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
    private readonly money: BooksMoneyService,
  ) {}

  async post(
    context: RequestContext,
    input: {
      businessDate?: string | undefined;
      note: string;
      lines: JournalLineInput[];
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<JournalEntry> {
    const businessDate = notInFuture(input.businessDate, today);
    const debits = sumOf(input.lines, 'DEBIT');
    if (!debits.equals(sumOf(input.lines, 'CREDIT')) || debits.isZero()) {
      // The contract refuses this first; the ledger's own trigger would too.
      throw new DomainError(
        'JOURNAL_NOT_BALANCED',
        'A journal’s debits and credits must be equal',
        [{ field: 'lines', issue: 'debits and credits differ' }],
      );
    }
    const id = await this.database.transaction(async (tx) => {
      const resolved: { ledgerAccountId: string; name: string }[] = [];
      for (const line of input.lines) {
        resolved.push(await this.account(tx, context, line));
      }
      const row = await tx.journalEntry.create({
        data: {
          organizationId: context.organizationId,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await this.ledger.post(context, {
        transactionType: 'JOURNAL',
        source: { table: 'journal_entry', id: row.id },
        businessDate,
        eventAt: new Date(),
        description: `Journal: ${input.note}`,
        lines: input.lines.map((line, index) => ({
          ledgerAccountId: resolved[index]!.ledgerAccountId,
          direction: line.direction,
          amount: toMoney(line.amount).toFixed(2),
        })),
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'journal_entry',
        entityId: row.id,
        after: {
          businessDate,
          note: input.note,
          amount: debits.toFixed(2),
          lines: input.lines.map((line, index) => ({
            account: resolved[index]!.name,
            direction: line.direction,
            amount: toMoney(line.amount).toFixed(2),
          })),
        },
      });
      return row.id;
    });
    const page = await this.list(context, { limit: 1, ids: [id] });
    return page.data[0]!;
  }

  async list(
    context: RequestContext,
    query: {
      from?: string | undefined;
      to?: string | undefined;
      cursor?: string | undefined;
      limit: number;
      ids?: string[];
    },
  ) {
    const where = inScope<Prisma.JournalEntryWhereInput>(booksScope(context), {
      ...dateRange(query),
      ...(query.ids ? { id: { in: query.ids } } : {}),
    });
    const tx = this.database.client;
    const [rows, total] = await Promise.all([
      tx.journalEntry.findMany({
        where,
        select: {
          id: true,
          businessDate: true,
          note: true,
          createdAt: true,
          createdByUserId: true,
        },
        ...newestFirst(query),
      }),
      tx.journalEntry.count({ where }),
    ]);
    const page = pageOf(rows, query);
    const ids = page.visible.map((row) => row.id);
    const postings = ids.length
      ? await tx.ledgerTransaction.findMany({
          where: { sourceTable: 'journal_entry', sourceId: { in: ids } },
          select: {
            sourceId: true,
            entries: {
              select: {
                direction: true,
                amount: true,
                ledgerAccount: {
                  select: {
                    accountType: true,
                    expenseCategory: { select: { name: true } },
                    bankAccount: { select: { name: true } },
                  },
                },
              },
            },
          },
        })
      : [];
    const users = await tx.user.findMany({
      where: { id: { in: page.visible.map((row) => row.createdByUserId) } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name]));

    const data: JournalEntry[] = page.visible.map((row) => {
      const entries =
        postings.find((posting) => posting.sourceId === row.id)?.entries ?? [];
      const lines = entries
        .filter((entry) => JOURNAL_TYPES.has(entry.ledgerAccount.accountType))
        .map((entry) => {
          const type = entry.ledgerAccount.accountType as JournalType;
          return {
            accountType: type,
            name:
              type === 'BANK'
                ? (entry.ledgerAccount.bankAccount?.name ?? 'Bank')
                : type === 'EXPENSE'
                  ? (entry.ledgerAccount.expenseCategory?.name ?? 'Expense')
                  : SINGLETON[type].name,
            direction: entry.direction,
            amount: toMoney(entry.amount.toString()).toFixed(2),
          };
        })
        // Debits first, as a journal is written.
        .sort((a, b) =>
          a.direction === b.direction ? 0 : a.direction === 'DEBIT' ? -1 : 1,
        );
      return {
        id: row.id,
        businessDate: fromUtcMidnight(row.businessDate),
        note: row.note,
        lines,
        amount: lines
          .filter((line) => line.direction === 'DEBIT')
          .reduce((sum, line) => sum.plus(line.amount), toMoney('0'))
          .toFixed(2),
        recordedBy: {
          userId: row.createdByUserId,
          name: names.get(row.createdByUserId) ?? 'Former staff',
        },
        createdAt: row.createdAt.toISOString(),
      };
    });
    return { data, nextCursor: page.nextCursor, hasMore: page.hasMore, total };
  }

  /** The ledger account a journal line names, created on first use. */
  private async account(
    tx: Tx,
    context: RequestContext,
    line: JournalLineInput,
  ): Promise<{ ledgerAccountId: string; name: string }> {
    if (line.accountType === 'BANK') {
      const place = await this.money.place(tx, context, line.bankAccountId);
      return { ledgerAccountId: place.ledgerAccountId, name: place.name };
    }
    if (line.accountType === 'EXPENSE') {
      const category = await this.money.activeCategory(
        tx,
        context,
        line.categoryId ?? '',
      );
      return {
        ledgerAccountId: await this.ledger.expenseAccount(
          context.organizationId,
          category.id,
        ),
        name: category.name,
      };
    }
    const singleton = SINGLETON[line.accountType];
    return {
      ledgerAccountId: await this.ledger.organizationAccount(
        context.organizationId,
        singleton.type,
      ),
      name: singleton.name,
    };
  }
}

function sumOf(lines: JournalLineInput[], direction: 'DEBIT' | 'CREDIT') {
  return lines
    .filter((line) => line.direction === direction)
    .reduce((sum, line) => sum.plus(line.amount), toMoney('0'));
}
