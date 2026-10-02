import { Injectable } from '@nestjs/common';
import type {
  BooksOverview,
  Expense,
  ExpensePage,
  MoneyMovement,
  MoneyMovementPage,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import {
  bankAccountScope,
  booksScope,
  expenseScope,
  foundInScope,
  inScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import { decodeCursor, encodeCursor } from '../platform/pagination.js';

type Tx = Database['client'];

const OFFICE_CASH = 'Cash-in-hand';

/** Where money is held: office cash, or one of the business's active banks. */
interface Place {
  ledgerAccountId: string;
  bankAccountId: string | null;
  name: string;
}

interface Range {
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

const expenseFields = {
  id: true,
  amount: true,
  businessDate: true,
  note: true,
  paidFrom: true,
  status: true,
  spenderUserId: true,
  hop: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionNote: true,
  createdByUserId: true,
  createdAt: true,
  expenseCategory: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, name: true } },
  line: { select: { id: true, name: true } },
} as const satisfies Prisma.ExpenseSelect;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseFields }>;

const movementFields = {
  id: true,
  amount: true,
  businessDate: true,
  note: true,
  createdByUserId: true,
  createdAt: true,
} as const;

interface MovementRow {
  id: string;
  amount: Prisma.Decimal;
  businessDate: Date;
  note: string;
  createdByUserId: string;
  createdAt: Date;
}

const money = (value: { toString(): string } | null | undefined) =>
  toMoney((value ?? 0).toString()).toFixed(2);

/**
 * Who may approve or reject a field expense (ADR-0018, decided 2026-09-24):
 * never its spender; a Junior's by their line's Senior or an Admin; a
 * Senior's own by an Admin only. Office expenses are never pending.
 */
export function mayDecideExpense(
  context: RequestContext,
  expense: {
    paidFrom: string;
    status: string;
    spenderUserId: string | null;
    hop: string | null;
    lineId: string | null;
  },
): boolean {
  if (expense.paidFrom !== 'CASH_IN_HAND' || expense.status !== 'PENDING') {
    return false;
  }
  if (expense.spenderUserId === context.userId) return false;
  if (context.role === 'ADMIN' || context.role === 'SUPER_ADMIN') return true;
  return (
    context.role === 'SENIOR' &&
    expense.hop === 'JUNIOR_TO_SENIOR' &&
    expense.lineId !== null &&
    expense.lineId === context.currentLineId
  );
}

/**
 * Books slice 2 (ADR-0018): the business's own money moving. Every entry is
 * written with its ledger posting and audit entry in one transaction — the
 * `CapitalService` pattern — and none is edited afterwards.
 *
 * - **Office expense:** DR EXPENSE[category] / CR office cash or a bank.
 * - **Bank transfer:** DR where it went / CR where it came from.
 * - **Other income:** DR office cash or a bank / CR OTHER_INCOME.
 * - **Drawings:** DR OWNER_DRAWINGS / CR office cash or a bank.
 *
 * Nothing refuses to take a balance below zero, exactly as disbursement may:
 * the screens show the balance and warn instead.
 */
@Injectable()
export class BooksMoneyService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
  ) {}

  // ------------------------------------------------------------- Expenses

  async recordExpense(
    context: RequestContext,
    input: {
      categoryId: string;
      amount: string;
      businessDate?: string | undefined;
      note: string;
      paidFrom: 'OFFICE_CASH' | 'BANK';
      bankAccountId?: string | undefined;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Expense> {
    const businessDate = notInFuture(input.businessDate, today);
    const amount = toMoney(input.amount).toFixed(2);
    const id = await this.database.transaction(async (tx) => {
      const category = await this.activeCategory(tx, context, input.categoryId);
      const from = await this.place(
        tx,
        context,
        input.paidFrom === 'BANK' ? input.bankAccountId : undefined,
      );
      const now = new Date();
      const row = await tx.expense.create({
        data: {
          organizationId: context.organizationId,
          expenseCategoryId: category.id,
          amount,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          paidFrom: input.paidFrom,
          bankAccountId: from.bankAccountId,
          // An office expense is recorded by the person who paid it out.
          status: 'APPROVED',
          decidedByUserId: context.userId,
          decidedAt: now,
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await this.ledger.post(context, {
        transactionType: 'EXPENSE',
        source: { table: 'expense', id: row.id },
        businessDate,
        eventAt: now,
        description: `${category.name}: ${input.note}`,
        lines: [
          {
            ledgerAccountId: await this.ledger.expenseAccount(
              context.organizationId,
              category.id,
            ),
            direction: 'DEBIT',
            amount,
          },
          {
            ledgerAccountId: from.ledgerAccountId,
            direction: 'CREDIT',
            amount,
          },
        ],
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'expense',
        entityId: row.id,
        after: {
          category: category.name,
          amount,
          businessDate,
          paidFrom: input.paidFrom,
          from: from.name,
          note: input.note,
        },
      });
      return row.id;
    });
    return this.getExpense(context, id);
  }

  async getExpense(context: RequestContext, id: string): Promise<Expense> {
    const row = foundInScope(
      await this.database.client.expense.findFirst({
        where: inScope(expenseScope(context), { id }),
        select: expenseFields,
      }),
      'expense',
    );
    return (await this.toExpenses(context, [row]))[0]!;
  }

  async listExpenses(
    context: RequestContext,
    query: Range & {
      categoryId?: string | undefined;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | undefined;
      paidFrom?: 'OFFICE_CASH' | 'BANK' | 'CASH_IN_HAND' | undefined;
    },
  ): Promise<ExpensePage> {
    const where = inScope(expenseScope(context), {
      ...dateRange(query),
      ...(query.categoryId ? { expenseCategoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.paidFrom ? { paidFrom: query.paidFrom } : {}),
    });
    const tx = this.database.client;
    const [rows, total, approved] = await Promise.all([
      tx.expense.findMany({
        where,
        select: expenseFields,
        ...newestFirst(query),
      }),
      tx.expense.count({ where }),
      tx.expense.aggregate({
        where: { AND: [where, { status: 'APPROVED' }] },
        _sum: { amount: true },
      }),
    ]);
    const page = pageOf(rows, query);
    return {
      data: await this.toExpenses(context, page.visible),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total,
      approvedTotal: money(approved._sum.amount),
    };
  }

  // ------------------------------------------------- Money between places

  async recordBankTransfer(
    context: RequestContext,
    input: {
      fromBankAccountId?: string | undefined;
      toBankAccountId?: string | undefined;
      amount: string;
      businessDate?: string | undefined;
      note: string;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<MoneyMovement> {
    const businessDate = notInFuture(input.businessDate, today);
    const amount = toMoney(input.amount).toFixed(2);
    if (input.fromBankAccountId === input.toBankAccountId) {
      throw new DomainError(
        'TRANSFER_SAME_PLACE',
        'Money has to move between two different places',
        [{ field: 'toBankAccountId', issue: 'is where it comes from' }],
      );
    }
    return this.database.transaction(async (tx) => {
      const from = await this.place(tx, context, input.fromBankAccountId);
      const to = await this.place(tx, context, input.toBankAccountId);
      const row = await tx.bankTransfer.create({
        data: {
          organizationId: context.organizationId,
          amount,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          fromBankAccountId: from.bankAccountId,
          toBankAccountId: to.bankAccountId,
          createdByUserId: context.userId,
        },
        select: movementFields,
      });
      await this.ledger.post(context, {
        transactionType: 'BANK_TRANSFER',
        source: { table: 'bank_transfer', id: row.id },
        businessDate,
        eventAt: new Date(),
        description: `${from.name} to ${to.name}: ${input.note}`,
        lines: [
          { ledgerAccountId: to.ledgerAccountId, direction: 'DEBIT', amount },
          {
            ledgerAccountId: from.ledgerAccountId,
            direction: 'CREDIT',
            amount,
          },
        ],
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'bank_transfer',
        entityId: row.id,
        after: { amount, businessDate, from: from.name, to: to.name },
      });
      return this.toMovement(row, placeView(from), placeView(to));
    });
  }

  async recordOtherIncome(
    context: RequestContext,
    input: {
      amount: string;
      businessDate?: string | undefined;
      note: string;
      bankAccountId?: string | undefined;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<MoneyMovement> {
    const businessDate = notInFuture(input.businessDate, today);
    const amount = toMoney(input.amount).toFixed(2);
    return this.database.transaction(async (tx) => {
      const into = await this.place(tx, context, input.bankAccountId);
      const row = await tx.incomeEntry.create({
        data: {
          organizationId: context.organizationId,
          amount,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          bankAccountId: into.bankAccountId,
          createdByUserId: context.userId,
        },
        select: movementFields,
      });
      await this.ledger.post(context, {
        transactionType: 'OTHER_INCOME',
        source: { table: 'income_entry', id: row.id },
        businessDate,
        eventAt: new Date(),
        description: `Other income: ${input.note}`,
        lines: [
          { ledgerAccountId: into.ledgerAccountId, direction: 'DEBIT', amount },
          {
            ledgerAccountId: await this.ledger.organizationAccount(
              context.organizationId,
              'OTHER_INCOME',
            ),
            direction: 'CREDIT',
            amount,
          },
        ],
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'income_entry',
        entityId: row.id,
        after: { amount, businessDate, into: into.name, note: input.note },
      });
      return this.toMovement(row, null, placeView(into));
    });
  }

  async recordDrawing(
    context: RequestContext,
    input: {
      amount: string;
      businessDate?: string | undefined;
      note: string;
      bankAccountId?: string | undefined;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<MoneyMovement> {
    const businessDate = notInFuture(input.businessDate, today);
    const amount = toMoney(input.amount).toFixed(2);
    return this.database.transaction(async (tx) => {
      const from = await this.place(tx, context, input.bankAccountId);
      const row = await tx.drawingEntry.create({
        data: {
          organizationId: context.organizationId,
          amount,
          businessDate: toUtcMidnight(businessDate),
          note: input.note,
          bankAccountId: from.bankAccountId,
          createdByUserId: context.userId,
        },
        select: movementFields,
      });
      await this.ledger.post(context, {
        transactionType: 'DRAWINGS',
        source: { table: 'drawing_entry', id: row.id },
        businessDate,
        eventAt: new Date(),
        description: `Owner drawings: ${input.note}`,
        lines: [
          {
            ledgerAccountId: await this.ledger.organizationAccount(
              context.organizationId,
              'OWNER_DRAWINGS',
            ),
            direction: 'DEBIT',
            amount,
          },
          {
            ledgerAccountId: from.ledgerAccountId,
            direction: 'CREDIT',
            amount,
          },
        ],
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'drawing_entry',
        entityId: row.id,
        after: { amount, businessDate, from: from.name, note: input.note },
      });
      return this.toMovement(row, placeView(from), null);
    });
  }

  async listBankTransfers(
    context: RequestContext,
    query: Range,
  ): Promise<MoneyMovementPage> {
    const where = inScope<Prisma.BankTransferWhereInput>(
      booksScope(context),
      dateRange(query),
    );
    const tx = this.database.client;
    const [rows, total, sum] = await Promise.all([
      tx.bankTransfer.findMany({
        where,
        select: {
          ...movementFields,
          fromBankAccount: { select: { id: true, name: true } },
          toBankAccount: { select: { id: true, name: true } },
        },
        ...newestFirst(query),
      }),
      tx.bankTransfer.count({ where }),
      tx.bankTransfer.aggregate({ where, _sum: { amount: true } }),
    ]);
    const page = pageOf(rows, query);
    const names = await this.names(
      page.visible.map((row) => row.createdByUserId),
    );
    return {
      data: page.visible.map((row) =>
        movement(
          row,
          bankPlace(row.fromBankAccount),
          bankPlace(row.toBankAccount),
          names,
        ),
      ),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total,
      amountTotal: money(sum._sum.amount),
    };
  }

  listOtherIncome(context: RequestContext, query: Range) {
    return this.listOneSided(context, query, 'income');
  }

  listDrawings(context: RequestContext, query: Range) {
    return this.listOneSided(context, query, 'drawings');
  }

  // ------------------------------------------------------------- Overview

  async overview(
    context: RequestContext,
    query: { date?: string | undefined },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<BooksOverview> {
    const asOf = query.date ? parseCalendarDate(query.date) : today;
    const from = startOfMonth(asOf);
    const scope = booksScope(context);
    const month = {
      businessDate: { gte: toUtcMidnight(from), lte: toUtcMidnight(asOf) },
    };
    const tx = this.database.client;
    const [office, banks, expenses, income, drawings, capital, pending] =
      await Promise.all([
        tx.ledgerAccount.findFirst({
          where: { ...scope, accountType: 'CASH_AT_OFFICE' },
          select: { balance: true },
        }),
        tx.bankAccount.findMany({
          where: { ...scope, isActive: true },
          select: {
            id: true,
            name: true,
            last4: true,
            ledgerAccounts: {
              where: { accountType: 'BANK' },
              select: { balance: true },
            },
          },
          orderBy: { name: 'asc' },
        }),
        tx.expense.aggregate({
          where: { ...scope, ...month, status: 'APPROVED' },
          _sum: { amount: true },
        }),
        tx.incomeEntry.aggregate({
          where: { ...scope, ...month },
          _sum: { amount: true },
        }),
        tx.drawingEntry.aggregate({
          where: { ...scope, ...month },
          _sum: { amount: true },
        }),
        tx.capitalEntry.aggregate({
          where: { ...scope, ...month },
          _sum: { amount: true },
        }),
        tx.expense.count({ where: { ...scope, status: 'PENDING' } }),
      ]);
    return {
      asOf,
      officeCash: money(office?.balance),
      banks: banks.map((bank) => ({
        bankAccountId: bank.id,
        name: bank.name,
        last4: bank.last4,
        balance: money(bank.ledgerAccounts[0]?.balance),
      })),
      month: {
        from,
        expenses: money(expenses._sum.amount),
        otherIncome: money(income._sum.amount),
        drawings: money(drawings._sum.amount),
        capital: money(capital._sum.amount),
        pendingFieldExpenses: pending,
      },
    };
  }

  // -------------------------------------------------------------- Helpers

  private async listOneSided(
    context: RequestContext,
    query: Range,
    kind: 'income' | 'drawings',
  ): Promise<MoneyMovementPage> {
    const where = { AND: [booksScope(context), dateRange(query)] };
    const select = {
      ...movementFields,
      bankAccount: { select: { id: true, name: true } },
    };
    const tx = this.database.client;
    const [rows, total, sum] =
      kind === 'income'
        ? await Promise.all([
            tx.incomeEntry.findMany({ where, select, ...newestFirst(query) }),
            tx.incomeEntry.count({ where }),
            tx.incomeEntry.aggregate({ where, _sum: { amount: true } }),
          ])
        : await Promise.all([
            tx.drawingEntry.findMany({ where, select, ...newestFirst(query) }),
            tx.drawingEntry.count({ where }),
            tx.drawingEntry.aggregate({ where, _sum: { amount: true } }),
          ]);
    const page = pageOf(rows, query);
    const names = await this.names(
      page.visible.map((row) => row.createdByUserId),
    );
    return {
      data: page.visible.map((row) => {
        const place = bankPlace(row.bankAccount);
        return kind === 'income'
          ? movement(row, null, place, names)
          : movement(row, place, null, names);
      }),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total,
      amountTotal: money(sum._sum.amount),
    };
  }

  /** Office cash, or an active bank of the caller's organization. */
  async place(
    tx: Tx,
    context: RequestContext,
    bankAccountId: string | undefined,
  ): Promise<Place> {
    if (!bankAccountId) {
      return {
        ledgerAccountId: await this.ledger.organizationAccount(
          context.organizationId,
          'CASH_AT_OFFICE',
        ),
        bankAccountId: null,
        name: OFFICE_CASH,
      };
    }
    // Held to commit, so the bank cannot be retired between this check and the
    // posting — `BankAccountService.update` takes `FOR UPDATE` on the same row.
    // The read after the lock sees the latest committed `isActive`.
    await tx.$queryRaw`SELECT id FROM bank_account WHERE id = ${bankAccountId} FOR SHARE`;
    const bank = foundInScope(
      await tx.bankAccount.findFirst({
        where: inScope(bankAccountScope(context), { id: bankAccountId }),
        select: { id: true, name: true, isActive: true },
      }),
      'bank account',
    );
    if (!bank.isActive) {
      throw new DomainError(
        'BANK_ACCOUNT_RETIRED',
        `${bank.name} is retired; no money moves in or out of it`,
      );
    }
    return {
      ledgerAccountId: await this.ledger.bankAccount(
        context.organizationId,
        bank.id,
      ),
      bankAccountId: bank.id,
      name: bank.name,
    };
  }

  /** An active category of the caller's organization; shared with field expenses. */
  async activeCategory(tx: Tx, context: RequestContext, categoryId: string) {
    const category = foundInScope(
      await tx.expenseCategory.findFirst({
        where: { organizationId: context.organizationId, id: categoryId },
        select: { id: true, name: true, isActive: true },
      }),
      'expense category',
    );
    if (!category.isActive) {
      throw new DomainError(
        'EXPENSE_CATEGORY_RETIRED',
        `${category.name} is retired; choose another category`,
        [{ field: 'categoryId', issue: 'is retired' }],
      );
    }
    return category;
  }

  private async toExpenses(
    context: RequestContext,
    rows: ExpenseRow[],
  ): Promise<Expense[]> {
    const names = await this.names(
      rows.flatMap((row) => [
        row.spenderUserId,
        row.decidedByUserId,
        row.createdByUserId,
      ]),
    );
    const who = (userId: string | null) =>
      userId ? { userId, name: names.get(userId) ?? 'Former staff' } : null;
    return rows.map((row) => ({
      id: row.id,
      category: row.expenseCategory,
      amount: money(row.amount),
      businessDate: fromUtcMidnight(row.businessDate),
      note: row.note,
      paidFrom: row.paidFrom,
      from:
        row.paidFrom === 'CASH_IN_HAND'
          ? {
              bankAccountId: null,
              name: `${names.get(row.spenderUserId ?? '') ?? 'Staff'}'s cash`,
            }
          : (bankPlace(row.bankAccount) ?? {
              bankAccountId: null,
              name: OFFICE_CASH,
            }),
      spender: who(row.spenderUserId),
      line: row.line,
      status: row.status,
      decidedBy:
        row.paidFrom === 'CASH_IN_HAND' ? who(row.decidedByUserId) : null,
      decidedAt:
        row.paidFrom === 'CASH_IN_HAND' && row.decidedAt
          ? row.decidedAt.toISOString()
          : null,
      decisionNote: row.decisionNote,
      recordedBy: who(row.createdByUserId),
      createdAt: row.createdAt.toISOString(),
      canDecide: mayDecideExpense(context, {
        ...row,
        lineId: row.line?.id ?? null,
      }),
    }));
  }

  private async toMovement(
    row: MovementRow,
    from: MoneyMovement['from'],
    to: MoneyMovement['to'],
  ): Promise<MoneyMovement> {
    return movement(row, from, to, await this.names([row.createdByUserId]));
  }

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.database.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

/** The business day money moved: today when absent, never in the future. */
export function notInFuture(
  value: string | undefined,
  today: CalendarDate,
): CalendarDate {
  const date = value ? parseCalendarDate(value) : today;
  if (date > today) {
    throw new DomainError(
      'BOOKS_DATE_IN_FUTURE',
      'Money is recorded on the day it moved, which cannot be in the future',
      [{ field: 'businessDate', issue: 'is in the future' }],
    );
  }
  return date;
}

export function dateRange(query: {
  from?: string | undefined;
  to?: string | undefined;
}) {
  if (!query.from && !query.to) return {};
  return {
    businessDate: {
      ...(query.from
        ? { gte: toUtcMidnight(parseCalendarDate(query.from)) }
        : {}),
      ...(query.to ? { lte: toUtcMidnight(parseCalendarDate(query.to)) } : {}),
    },
  };
}

/** Newest first; (businessDate, createdAt, id) is a total order. */
export function newestFirst(query: {
  cursor?: string | undefined;
  limit: number;
}) {
  return {
    orderBy: [
      { businessDate: 'desc' as const },
      { createdAt: 'desc' as const },
      { id: 'desc' as const },
    ],
    take: query.limit + 1,
    ...(query.cursor
      ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }
      : {}),
  };
}

export function pageOf<Row extends { id: string }>(
  rows: Row[],
  query: { limit: number },
) {
  const hasMore = rows.length > query.limit;
  const visible = hasMore ? rows.slice(0, query.limit) : rows;
  return {
    visible,
    hasMore,
    nextCursor:
      hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
  };
}

function placeView(place: Place) {
  return { bankAccountId: place.bankAccountId, name: place.name };
}

function bankPlace(bank: { id: string; name: string } | null) {
  return bank
    ? { bankAccountId: bank.id, name: bank.name }
    : { bankAccountId: null, name: OFFICE_CASH };
}

function movement(
  row: MovementRow,
  from: MoneyMovement['from'],
  to: MoneyMovement['to'],
  names: Map<string, string>,
): MoneyMovement {
  return {
    id: row.id,
    amount: money(row.amount),
    businessDate: fromUtcMidnight(row.businessDate),
    note: row.note,
    from,
    to,
    recordedBy: {
      userId: row.createdByUserId,
      name: names.get(row.createdByUserId) ?? 'Former staff',
    },
    createdAt: row.createdAt.toISOString(),
  };
}
