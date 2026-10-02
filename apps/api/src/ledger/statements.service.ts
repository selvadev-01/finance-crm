import { Injectable } from '@nestjs/common';
import {
  type AccountStatement,
  type BalanceSheet,
  MAX_STATEMENT_DAYS,
  type ProfitAndLoss,
} from '@repo/contracts';
import {
  type CalendarDate,
  daysBetween,
  fromUtcMidnight,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import {
  bankAccountScope,
  foundInScope,
  inScope,
  seesOrganizationLedger,
} from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError, ValidationError } from '../platform/errors/errors.js';

type Decimal = ReturnType<typeof toMoney>;
type AccountType = AccountStatement['account']['accountType'];

/** One account type's net (debits − credits), split by owner or reference. */
interface Net {
  accountType: AccountType;
  key: string | null;
  name: string | null;
  net: Decimal;
}

const ZERO = () => toMoney('0');
const fixed = (value: Decimal) => value.toFixed(2);

/** Names an account the way the statements print it. */
const NAMES: Partial<Record<AccountType, string>> = {
  CASH_AT_OFFICE: 'Cash in hand',
  CAPITAL: 'Capital',
  UNEARNED_PROFIT: 'Unearned profit',
  EARNED_PROFIT: 'Earned profit',
  WRITE_OFF_LOSS: 'Write-off loss',
  OTHER_INCOME: 'Other income',
  OWNER_DRAWINGS: 'Owner drawings',
};

/** Debit-normal types; the rest are credit-normal (the ledger's own CHECK). */
const DEBIT_NORMAL = new Set<AccountType>([
  'CASH_IN_HAND',
  'CASH_AT_OFFICE',
  'LOAN_RECEIVABLE',
  'WRITE_OFF_LOSS',
  'EXPENSE',
  'BANK',
  'OWNER_DRAWINGS',
]);

/**
 * Books slice 4 (ADR-0018): profit and loss, the balance sheet and account
 * statements, read from the ledger's entries — never the cached balances —
 * exactly as the trial balance is, so the three always agree with it.
 *
 * The balance sheet balances by construction: every posting is balanced
 * (ADR-0006), so Σ debit-normal = Σ credit-normal, which rearranges to
 * `assets − unearned profit = capital − drawings + retained profit`.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly database: Database) {}

  async profitAndLoss(
    context: RequestContext,
    query: { from?: string | undefined; to?: string | undefined },
    now: Date = new Date(),
  ): Promise<ProfitAndLoss> {
    const { from, to } = statementRange(query, now);
    const nets = await this.nets(context, { from, to });
    const credit = (type: AccountType) => sum(nets, type).negated();
    const earnedProfit = credit('EARNED_PROFIT');
    const otherIncome = credit('OTHER_INCOME');
    const income = earnedProfit.plus(otherIncome);
    const categories = nets
      .filter((row) => row.accountType === 'EXPENSE' && !row.net.isZero())
      .sort(
        (a, b) =>
          b.net.comparedTo(a.net) || (a.name ?? '').localeCompare(b.name ?? ''),
      );
    const writeOffLoss = sum(nets, 'WRITE_OFF_LOSS');
    const expenses = sum(nets, 'EXPENSE').plus(writeOffLoss);
    return {
      from,
      to,
      generatedAt: now.toISOString(),
      income: {
        earnedProfit: fixed(earnedProfit),
        otherIncome: fixed(otherIncome),
        total: fixed(income),
      },
      expenses: {
        categories: categories.map((row) => ({
          categoryId: row.key!,
          name: row.name ?? 'Expense',
          amount: fixed(row.net),
        })),
        writeOffLoss: fixed(writeOffLoss),
        total: fixed(expenses),
      },
      netProfit: fixed(income.minus(expenses)),
    };
  }

  async balanceSheet(
    context: RequestContext,
    query: { date?: string | undefined },
    now: Date = new Date(),
  ): Promise<BalanceSheet> {
    const today = toBusinessDate(now);
    const asOf = query.date ? parseCalendarDate(query.date) : today;
    if (asOf > today) throw futureDate('date');
    const nets = await this.nets(context, { to: asOf });
    const holdings = (type: AccountType) =>
      nets
        .filter((row) => row.accountType === type && !row.net.isZero())
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        .map((row) => ({
          id: row.key ?? type,
          name: row.name ?? type,
          balance: fixed(row.net),
        }));

    const officeCash = sum(nets, 'CASH_AT_OFFICE');
    const banks = sum(nets, 'BANK');
    const staff = sum(nets, 'CASH_IN_HAND');
    const loans = sum(nets, 'LOAN_RECEIVABLE');
    const unearned = sum(nets, 'UNEARNED_PROFIT').negated();
    const assets = officeCash
      .plus(banks)
      .plus(staff)
      .plus(loans)
      .minus(unearned);

    const capital = sum(nets, 'CAPITAL').negated();
    const drawings = sum(nets, 'OWNER_DRAWINGS');
    const retained = sum(nets, 'EARNED_PROFIT')
      .plus(sum(nets, 'OTHER_INCOME'))
      .negated()
      .minus(sum(nets, 'EXPENSE'))
      .minus(sum(nets, 'WRITE_OFF_LOSS'));
    const equity = capital.minus(drawings).plus(retained);

    return {
      asOf,
      generatedAt: now.toISOString(),
      assets: {
        officeCash: fixed(officeCash),
        banks: holdings('BANK'),
        cashWithStaff: holdings('CASH_IN_HAND'),
        loansReceivable: fixed(loans),
        unearnedProfit: fixed(unearned),
        total: fixed(assets),
      },
      equity: {
        capital: fixed(capital),
        drawings: fixed(drawings),
        retainedProfit: fixed(retained),
        total: fixed(equity),
      },
      balanced: assets.equals(equity),
    };
  }

  async accountStatement(
    context: RequestContext,
    ledgerAccountId: string,
    query: { from?: string | undefined; to?: string | undefined },
    now: Date = new Date(),
  ): Promise<AccountStatement> {
    const { from, to } = statementRange(query, now);
    const account = foundInScope(
      seesOrganizationLedger(context)
        ? await this.database.client.ledgerAccount.findFirst({
            where: {
              id: ledgerAccountId,
              organizationId: context.organizationId,
            },
            select: {
              id: true,
              accountType: true,
              ownerUserId: true,
              expenseCategory: { select: { name: true } },
              bankAccount: { select: { name: true } },
              accountLoan: { select: { accountCode: true } },
            },
          })
        : null,
      'ledger account',
    );
    const owner = account.ownerUserId
      ? await this.database.client.user.findUnique({
          where: { id: account.ownerUserId },
          select: { name: true },
        })
      : null;
    const name =
      account.accountType === 'CASH_IN_HAND'
        ? `${owner?.name ?? 'Former staff'}'s cash in hand`
        : account.accountType === 'EXPENSE'
          ? (account.expenseCategory?.name ?? 'Expense')
          : account.accountType === 'BANK'
            ? (account.bankAccount?.name ?? 'Bank')
            : account.accountType === 'LOAN_RECEIVABLE'
              ? `Receivable · ${account.accountLoan?.accountCode ?? ''}`.trim()
              : (NAMES[account.accountType] ?? account.accountType);
    return this.statement(
      { id: account.id, accountType: account.accountType, name },
      from,
      to,
      now,
    );
  }

  /** The statement of office cash, or of one of the organization's banks. */
  async cashBook(
    context: RequestContext,
    query: {
      from?: string | undefined;
      to?: string | undefined;
      bankAccountId?: string | undefined;
    },
    now: Date = new Date(),
  ): Promise<AccountStatement> {
    const { from, to } = statementRange(query, now);
    if (!seesOrganizationLedger(context)) {
      foundInScope(null, 'ledger account');
    }
    const tx = this.database.client;
    if (query.bankAccountId) {
      const bank = foundInScope(
        await tx.bankAccount.findFirst({
          where: inScope(bankAccountScope(context), {
            id: query.bankAccountId,
          }),
          select: { id: true, name: true },
        }),
        'bank account',
      );
      const account = await tx.ledgerAccount.findFirst({
        where: {
          organizationId: context.organizationId,
          accountType: 'BANK',
          bankAccountId: bank.id,
        },
        select: { id: true },
      });
      return this.statement(
        { id: account?.id ?? null, accountType: 'BANK', name: bank.name },
        from,
        to,
        now,
      );
    }
    const office = await tx.ledgerAccount.findFirst({
      where: {
        organizationId: context.organizationId,
        accountType: 'CASH_AT_OFFICE',
      },
      select: { id: true },
    });
    return this.statement(
      {
        id: office?.id ?? null,
        accountType: 'CASH_AT_OFFICE',
        name: 'Cash in hand',
      },
      from,
      to,
      now,
    );
  }

  /**
   * A cash book or statement over a range. Reading never creates a ledger
   * account: a place nothing has moved through (`id` null) has an empty book.
   */
  private async statement(
    account: { id: string | null; accountType: AccountType; name: string },
    from: CalendarDate,
    to: CalendarDate,
    now: Date,
  ): Promise<AccountStatement> {
    const tx = this.database.client;
    const sign = DEBIT_NORMAL.has(account.accountType) ? 1 : -1;
    // No account: no entries. `''` matches no id, so one query shape serves.
    const accountId = account.id ?? '';
    const [before] = await tx.$queryRaw<{ net: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount ELSE -e.amount END), 0)::text AS net
      FROM ledger_entry e
      JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
      WHERE e."ledgerAccountId" = ${accountId}
        AND t."businessDate" < ${toUtcMidnight(from)}`;
    const rows = await tx.$queryRaw<
      {
        ledgerTransactionId: string;
        businessDate: Date;
        transactionType: AccountStatement['entries'][number]['transactionType'];
        description: string;
        direction: 'DEBIT' | 'CREDIT';
        amount: string;
      }[]
    >`
      SELECT t.id AS "ledgerTransactionId", t."businessDate", t."transactionType",
             t.description, e.direction, e.amount::text AS amount
      FROM ledger_entry e
      JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
      WHERE e."ledgerAccountId" = ${accountId}
        AND t."businessDate" BETWEEN ${toUtcMidnight(from)} AND ${toUtcMidnight(to)}
      ORDER BY t."businessDate", t."eventAt", t."createdAt", e.id`;

    const opening = toMoney(before?.net ?? '0').times(sign);
    let balance = opening;
    let debits = ZERO();
    let credits = ZERO();
    const entries = rows.map((row) => {
      const amount = toMoney(row.amount);
      const debit = row.direction === 'DEBIT';
      if (debit) debits = debits.plus(amount);
      else credits = credits.plus(amount);
      balance = balance.plus(
        debit === (sign === 1) ? amount : amount.negated(),
      );
      return {
        ledgerTransactionId: row.ledgerTransactionId,
        businessDate: fromUtcMidnight(row.businessDate),
        transactionType: row.transactionType,
        description: row.description,
        debit: debit ? fixed(amount) : '0.00',
        credit: debit ? '0.00' : fixed(amount),
        balance: fixed(balance),
      };
    });
    return {
      account: {
        ledgerAccountId: account.id,
        accountType: account.accountType,
        name: account.name,
        normalBalance: sign === 1 ? 'DEBIT' : 'CREDIT',
      },
      from,
      to,
      generatedAt: now.toISOString(),
      opening: fixed(opening),
      entries,
      totals: { debits: fixed(debits), credits: fixed(credits) },
      closing: fixed(balance),
    };
  }

  /**
   * Debits − credits per account type over a range (or up to a date), split
   * by staff member for cash in hand and by category or bank for expenses
   * and banks. Admin and above only; anyone else reads nothing.
   */
  private async nets(
    context: RequestContext,
    range: { from?: CalendarDate; to: CalendarDate },
  ): Promise<Net[]> {
    if (!seesOrganizationLedger(context)) return [];
    const first = range.from
      ? toUtcMidnight(range.from)
      : new Date('1970-01-01');
    const rows = await this.database.client.$queryRaw<
      {
        accountType: AccountType;
        key: string | null;
        name: string | null;
        net: string;
      }[]
    >`
      SELECT la."accountType",
             COALESCE(la."ownerUserId", la."expenseCategoryId", la."bankAccountId") AS key,
             COALESCE(u.name, c.name, b.name) AS name,
             COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount ELSE -e.amount END), 0)::text AS net
      FROM ledger_entry e
      JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
      JOIN ledger_account la ON la.id = e."ledgerAccountId"
      LEFT JOIN "user" u ON u.id = la."ownerUserId"
      LEFT JOIN expense_category c ON c.id = la."expenseCategoryId"
      LEFT JOIN bank_account b ON b.id = la."bankAccountId"
      WHERE la."organizationId" = ${context.organizationId}
        AND t."businessDate" BETWEEN ${first} AND ${toUtcMidnight(range.to)}
      GROUP BY 1, 2, 3`;
    return rows.map((row) => ({ ...row, net: toMoney(row.net) }));
  }
}

function sum(nets: Net[], type: AccountType): Decimal {
  return nets
    .filter((row) => row.accountType === type)
    .reduce((total, row) => total.plus(row.net), ZERO());
}

function futureDate(field: string) {
  return new DomainError(
    'DATE_IN_FUTURE',
    'A statement covers today or earlier days',
    [{ field, issue: 'is after today' }],
  );
}

/**
 * `to` defaults to today and `from` to the first of `to`'s month; up to
 * {@link MAX_STATEMENT_DAYS} days, so a year's profit and loss is one read.
 */
export function statementRange(
  query: { from?: string | undefined; to?: string | undefined },
  now: Date,
): { from: CalendarDate; to: CalendarDate } {
  const today = toBusinessDate(now);
  const to = query.to ? parseCalendarDate(query.to) : today;
  if (to > today) throw futureDate('to');
  const from = query.from ? parseCalendarDate(query.from) : startOfMonth(to);
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_STATEMENT_DAYS) {
    throw new ValidationError(
      'INVALID_DATE_RANGE',
      `Choose a range of up to ${MAX_STATEMENT_DAYS} days, with "from" on or before "to"`,
      [
        {
          field: span < 0 ? 'from' : 'to',
          issue: `must be 0–${MAX_STATEMENT_DAYS - 1} days after from`,
        },
      ],
    );
  }
  return { from, to };
}
