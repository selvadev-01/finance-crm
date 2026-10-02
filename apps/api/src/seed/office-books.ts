import { randomUUID } from 'node:crypto';

import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  type HolidaySet,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { STARTER_EXPENSE_CATEGORIES } from '../books/expense-category.service.js';
import {
  createLedgerPoster,
  ist,
  type LedgerPoster,
  workingDaysBefore,
  writePostings,
} from './seed-ledger.js';

/**
 * The office side of the seeded Books (ADR-0018): one bank, a deposit of
 * office cash, rent, stationery, a salary from the bank, bank interest, an
 * owner drawing and a bank-charges journal — recorded by the Admin, the
 * drawing and the journal by the Super Admin, whose alone they are.
 *
 * `seedDataset` plans them into its own batches (`planOfficeBooks`);
 * `run.ts` gives a seed committed before Books existed its office books
 * (`seedOfficeBooks`), finding the ledger accounts that are already there.
 */
export const SEED_BANK_NAME = 'Seed Bank';

type Category = (typeof STARTER_EXPENSE_CATEGORIES)[number];

export interface OfficeBooksOptions {
  organizationId: string;
  asOf: CalendarDate;
  holidays: HolidaySet;
  adminUserId: string;
  superAdminUserId: string;
}

/** Ledger accounts that already exist; whatever is missing is created. */
export interface KnownOfficeAccounts {
  categoryIds: Partial<Record<Category, string>>;
  officeCash?: string;
  otherIncome?: string;
  ownerDrawings?: string;
  expense: Partial<Record<Category, string>>;
}

export interface OfficeBooksRows {
  bank: Prisma.BankAccountCreateManyInput;
  expenses: Prisma.ExpenseCreateManyInput[];
  transfers: Prisma.BankTransferCreateManyInput[];
  incomes: Prisma.IncomeEntryCreateManyInput[];
  drawings: Prisma.DrawingEntryCreateManyInput[];
  journals: Prisma.JournalEntryCreateManyInput[];
}

/**
 * Plans the office books without touching the database: posts into `poster`
 * and adds the ledger accounts it needs to `ledgerAccounts`, so `seedDataset`
 * writes them in its own batches — over a remote database every round trip
 * counts against the transaction's timeout.
 */
export function planOfficeBooks(
  options: OfficeBooksOptions,
  known: KnownOfficeAccounts,
  poster: LedgerPoster,
  ledgerAccounts: Prisma.LedgerAccountCreateManyInput[],
): OfficeBooksRows {
  const { organizationId: orgId, adminUserId, superAdminUserId } = options;
  const daysBack = (n: number) =>
    workingDaysBefore(options.asOf, n, options.holidays);
  const categoryId = (name: Category) => {
    const id = known.categoryIds[name];
    if (!id) throw new Error(`Expense category "${name}" is missing`);
    return id;
  };
  const singleton = (
    found: string | undefined,
    accountType: 'CASH_AT_OFFICE' | 'OTHER_INCOME' | 'OWNER_DRAWINGS',
    normalBalance: 'DEBIT' | 'CREDIT',
  ) => {
    if (found) return found;
    const id = randomUUID();
    ledgerAccounts.push({
      id,
      organizationId: orgId,
      accountType,
      normalBalance,
    });
    return id;
  };
  const officeCash = singleton(known.officeCash, 'CASH_AT_OFFICE', 'DEBIT');
  const otherIncome = singleton(known.otherIncome, 'OTHER_INCOME', 'CREDIT');
  const ownerDrawings = singleton(
    known.ownerDrawings,
    'OWNER_DRAWINGS',
    'DEBIT',
  );
  const expenseAccounts = new Map<Category, string>();
  const expenseAccount = (name: Category) => {
    let id = expenseAccounts.get(name) ?? known.expense[name];
    if (!id) {
      id = randomUUID();
      ledgerAccounts.push({
        id,
        organizationId: orgId,
        accountType: 'EXPENSE',
        expenseCategoryId: categoryId(name),
        normalBalance: 'DEBIT',
      });
    }
    expenseAccounts.set(name, id);
    return id;
  };
  const bankId = randomUUID();
  const bankLedger = randomUUID();
  ledgerAccounts.push({
    id: bankLedger,
    organizationId: orgId,
    accountType: 'BANK',
    bankAccountId: bankId,
    normalBalance: 'DEBIT',
  });

  const { post } = poster;
  const expenseRows: Prisma.ExpenseCreateManyInput[] = [];
  const officeExpense = (
    date: CalendarDate,
    category: Category,
    amount: string,
    note: string,
    fromBank: boolean,
  ) => {
    const id = randomUUID();
    expenseRows.push({
      id,
      organizationId: orgId,
      expenseCategoryId: categoryId(category),
      amount,
      businessDate: toUtcMidnight(date),
      note,
      paidFrom: fromBank ? 'BANK' : 'OFFICE_CASH',
      bankAccountId: fromBank ? bankId : null,
      status: 'APPROVED',
      decidedByUserId: adminUserId,
      decidedAt: ist(date, '11:00:00'),
      createdByUserId: adminUserId,
    });
    post('EXPENSE', { table: 'expense', id }, date, `${category}: ${note}`, [
      {
        account: expenseAccount(category),
        direction: 'DEBIT',
        amount: toMoney(amount),
      },
      {
        account: fromBank ? bankLedger : officeCash,
        direction: 'CREDIT',
        amount: toMoney(amount),
      },
    ]);
  };
  const depositDate = daysBack(20);
  const salaryDate = daysBack(10);
  const sundriesDate = daysBack(7);
  const journalDate = daysBack(4);

  const transferRows: Prisma.BankTransferCreateManyInput[] = [
    {
      id: randomUUID(),
      organizationId: orgId,
      amount: '50000.00',
      businessDate: toUtcMidnight(depositDate),
      note: 'Deposit of office cash',
      toBankAccountId: bankId,
      createdByUserId: adminUserId,
    },
  ];
  post(
    'BANK_TRANSFER',
    { table: 'bank_transfer', id: transferRows[0]!.id! },
    depositDate,
    `Cash in hand → ${SEED_BANK_NAME}: Deposit of office cash`,
    [
      { account: bankLedger, direction: 'DEBIT', amount: toMoney('50000') },
      { account: officeCash, direction: 'CREDIT', amount: toMoney('50000') },
    ],
  );
  officeExpense(depositDate, 'Rent', '6000.00', 'Office rent', false);
  officeExpense(salaryDate, 'Salary', '15000.00', 'Staff salaries', true);
  officeExpense(
    sundriesDate,
    'Stationery & printing',
    '450.00',
    'Receipt books',
    false,
  );

  const incomeRows: Prisma.IncomeEntryCreateManyInput[] = [
    {
      id: randomUUID(),
      organizationId: orgId,
      amount: '125.50',
      businessDate: toUtcMidnight(sundriesDate),
      note: 'Interest on the bank balance',
      bankAccountId: bankId,
      createdByUserId: adminUserId,
    },
  ];
  post(
    'OTHER_INCOME',
    { table: 'income_entry', id: incomeRows[0]!.id! },
    sundriesDate,
    'Other income: Interest on the bank balance',
    [
      { account: bankLedger, direction: 'DEBIT', amount: toMoney('125.50') },
      { account: otherIncome, direction: 'CREDIT', amount: toMoney('125.50') },
    ],
  );

  const drawingRows: Prisma.DrawingEntryCreateManyInput[] = [
    {
      id: randomUUID(),
      organizationId: orgId,
      amount: '5000.00',
      businessDate: toUtcMidnight(salaryDate),
      note: 'Owner drawing',
      bankAccountId: bankId,
      createdByUserId: superAdminUserId,
    },
  ];
  post(
    'DRAWINGS',
    { table: 'drawing_entry', id: drawingRows[0]!.id! },
    salaryDate,
    'Drawing: Owner drawing',
    [
      { account: ownerDrawings, direction: 'DEBIT', amount: toMoney('5000') },
      { account: bankLedger, direction: 'CREDIT', amount: toMoney('5000') },
    ],
  );

  const journalRows: Prisma.JournalEntryCreateManyInput[] = [
    {
      id: randomUUID(),
      organizationId: orgId,
      businessDate: toUtcMidnight(journalDate),
      note: 'Bank charges found on the passbook',
      createdByUserId: superAdminUserId,
    },
  ];
  post(
    'JOURNAL',
    { table: 'journal_entry', id: journalRows[0]!.id! },
    journalDate,
    'Journal: Bank charges found on the passbook',
    [
      {
        account: expenseAccount('Bank charges'),
        direction: 'DEBIT',
        amount: toMoney('118'),
      },
      { account: bankLedger, direction: 'CREDIT', amount: toMoney('118') },
    ],
  );

  return {
    bank: {
      id: bankId,
      organizationId: orgId,
      name: SEED_BANK_NAME,
      last4: '4321',
    },
    expenses: expenseRows,
    transfers: transferRows,
    incomes: incomeRows,
    drawings: drawingRows,
    journals: journalRows,
  };
}

/**
 * Writes the planned rows — the bank first, which the expenses, entries and
 * its ledger account refer to. Ledger accounts and postings are the caller's.
 */
export async function writeOfficeBooks(
  tx: Prisma.TransactionClient,
  rows: OfficeBooksRows,
) {
  await tx.bankAccount.create({ data: rows.bank });
  await tx.expense.createMany({ data: rows.expenses });
  await tx.bankTransfer.createMany({ data: rows.transfers });
  await tx.incomeEntry.createMany({ data: rows.incomes });
  await tx.drawingEntry.createMany({ data: rows.drawings });
  await tx.journalEntry.createMany({ data: rows.journals });
}

/** Adds the office books to an organization that already exists. */
export async function seedOfficeBooks(
  tx: Prisma.TransactionClient,
  options: OfficeBooksOptions,
): Promise<{
  expenses: number;
  ledgerTransactions: number;
  ledgerEntries: number;
}> {
  const organizationId = options.organizationId;
  const categories = await tx.expenseCategory.findMany({
    where: { organizationId, name: { in: [...STARTER_EXPENSE_CATEGORIES] } },
    select: { id: true, name: true },
  });
  const existing = await tx.ledgerAccount.findMany({
    where: {
      organizationId,
      accountType: {
        in: ['CASH_AT_OFFICE', 'OTHER_INCOME', 'OWNER_DRAWINGS', 'EXPENSE'],
      },
    },
    select: { id: true, accountType: true, expenseCategoryId: true },
  });
  const ofType = (type: string) =>
    existing.find((account) => account.accountType === type)?.id;
  const known: KnownOfficeAccounts = {
    categoryIds: Object.fromEntries(
      categories.map((category) => [category.name, category.id]),
    ),
    officeCash: ofType('CASH_AT_OFFICE'),
    otherIncome: ofType('OTHER_INCOME'),
    ownerDrawings: ofType('OWNER_DRAWINGS'),
    expense: Object.fromEntries(
      categories.flatMap((category) => {
        const account = existing.find(
          (a) =>
            a.accountType === 'EXPENSE' && a.expenseCategoryId === category.id,
        );
        return account ? [[category.name, account.id]] : [];
      }),
    ),
  };

  const poster = createLedgerPoster();
  const ledgerAccounts: Prisma.LedgerAccountCreateManyInput[] = [];
  const rows = planOfficeBooks(options, known, poster, ledgerAccounts);
  await writeOfficeBooks(tx, rows);
  await tx.ledgerAccount.createMany({ data: ledgerAccounts });
  await writePostings(tx, poster);

  return {
    expenses: rows.expenses.length,
    ledgerTransactions: poster.transactions.length,
    ledgerEntries: poster.entries.length,
  };
}
