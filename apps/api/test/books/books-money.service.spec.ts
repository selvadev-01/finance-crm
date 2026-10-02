import type { PrismaClient } from '@repo/db';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { BankAccountService } from '../../src/books/bank-account.service.js';
import { BooksMoneyService } from '../../src/books/books-money.service.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { TrialBalanceService } from '../../src/ledger/trial-balance.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Books slice 2 (ADR-0018), rolled back: office expenses, bank transfers,
 * other income and drawings, each posted with its source row and audit.
 */
describe('books money (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function moneyWorld(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
    const banks = new BankAccountService(database, audit);
    const sbi = await banks.create(owner, { name: 'SBI Mylapore' });
    const category = (name: string) =>
      tx.expenseCategory.findFirstOrThrow({
        where: { organizationId: w.organizationId, name },
      });
    // cashWorld's organization predates the starter list: add the two used.
    await tx.expenseCategory.createMany({
      data: ['Rent', 'Phone & internet'].map((name) => ({
        organizationId: w.organizationId,
        name,
      })),
    });
    return {
      ...w,
      owner,
      sbi,
      banks,
      category,
      money: new BooksMoneyService(database, audit, ledger),
      capital: new CapitalService(database, audit, ledger),
      trial: new TrialBalanceService(database),
    };
  }

  it('moves office cash and the bank to the paisa, and the books still balance', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await moneyWorld(tx);
      const rent = await w.category('Rent');
      const phone = await w.category('Phone & internet');

      await w.capital.add(
        w.owner,
        { amount: '10000', note: 'Opening capital' },
        MONDAY,
      );
      const expense = await w.money.recordExpense(
        w.admin,
        {
          categoryId: rent.id,
          amount: '3000',
          note: 'January rent',
          paidFrom: 'OFFICE_CASH',
        },
        MONDAY,
      );
      expect(expense).toMatchObject({
        category: { name: 'Rent' },
        amount: '3000.00',
        status: 'APPROVED',
        from: { bankAccountId: null, name: 'Cash in hand' },
        spender: null,
      });
      await w.money.recordBankTransfer(
        w.admin,
        { toBankAccountId: w.sbi.id, amount: '5000', note: 'Deposit' },
        MONDAY,
      );
      await w.money.recordExpense(
        w.admin,
        {
          categoryId: phone.id,
          amount: '500',
          note: 'Broadband',
          paidFrom: 'BANK',
          bankAccountId: w.sbi.id,
        },
        MONDAY,
      );
      await w.money.recordOtherIncome(
        w.admin,
        { amount: '200', note: 'Processing fee' },
        MONDAY,
      );
      await w.money.recordDrawing(
        w.owner,
        { amount: '1000', note: 'For home' },
        MONDAY,
      );

      const overview = await w.money.overview(w.admin, { date: MONDAY });
      expect(overview).toMatchObject({
        officeCash: '1200.00',
        banks: [{ name: 'SBI Mylapore', balance: '4500.00' }],
        month: {
          expenses: '3500.00',
          otherIncome: '200.00',
          drawings: '1000.00',
          capital: '10000.00',
          pendingFieldExpenses: 0,
        },
      });

      const trial = await w.trial.trialBalance(w.admin, { date: MONDAY });
      expect(trial.balanced).toBe(true);
      const row = (type: string, name?: string) =>
        trial.rows.find(
          (r) => r.accountType === type && (!name || r.referenceName === name),
        );
      expect(row('EXPENSE', 'Rent')?.debitBalance).toBe('3000.00');
      expect(row('EXPENSE', 'Phone & internet')?.debitBalance).toBe('500.00');
      expect(row('OTHER_INCOME')?.creditBalance).toBe('200.00');
      expect(row('OWNER_DRAWINGS')?.debitBalance).toBe('1000.00');

      const audited = await tx.auditLog.findMany({
        where: {
          organizationId: w.organizationId,
          entityTable: {
            in: ['expense', 'bank_transfer', 'income_entry', 'drawing_entry'],
          },
        },
      });
      expect(audited.map((r) => r.entityTable).sort()).toEqual([
        'bank_transfer',
        'drawing_entry',
        'expense',
        'expense',
        'income_entry',
      ]);
    });
  });

  it('lists each kind newest first with its total, and only for Admins', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await moneyWorld(tx);
      const rent = await w.category('Rent');
      await w.money.recordExpense(
        w.admin,
        {
          categoryId: rent.id,
          amount: '3000',
          note: 'January rent',
          paidFrom: 'OFFICE_CASH',
        },
        MONDAY,
      );
      await w.money.recordBankTransfer(
        w.admin,
        { toBankAccountId: w.sbi.id, amount: '700', note: 'Deposit' },
        MONDAY,
      );
      await w.money.recordBankTransfer(
        w.admin,
        { fromBankAccountId: w.sbi.id, amount: '200', note: 'Withdrawal' },
        MONDAY,
      );

      const expenses = await w.money.listExpenses(w.admin, { limit: 50 });
      expect(expenses).toMatchObject({ total: 1, approvedTotal: '3000.00' });
      const transfers = await w.money.listBankTransfers(w.admin, { limit: 50 });
      expect(
        transfers.data.map((t) => [t.note, t.from?.name, t.to?.name]),
      ).toEqual([
        ['Withdrawal', 'SBI Mylapore', 'Cash in hand'],
        ['Deposit', 'Cash in hand', 'SBI Mylapore'],
      ]);
      expect(transfers.amountTotal).toBe('900.00');

      // A Senior sees no office expenses and none of the business's own money.
      expect((await w.money.listExpenses(w.senior, { limit: 50 })).total).toBe(
        0,
      );
      expect(
        (await w.money.listBankTransfers(w.senior, { limit: 50 })).total,
      ).toBe(0);
    });
  });

  it('refuses a future date, a retired category, a retired bank and a transfer to the same place, writing nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await moneyWorld(tx);
      const rent = await w.category('Rent');

      await expect(
        w.money.recordExpense(
          w.admin,
          {
            categoryId: rent.id,
            amount: '10',
            businessDate: '2026-01-06',
            note: 'Tomorrow',
            paidFrom: 'OFFICE_CASH',
          },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'BOOKS_DATE_IN_FUTURE', status: 422 });

      await expect(
        w.money.recordBankTransfer(
          w.admin,
          {
            fromBankAccountId: w.sbi.id,
            toBankAccountId: w.sbi.id,
            amount: '10',
            note: 'Loop',
          },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'TRANSFER_SAME_PLACE', status: 422 });

      await tx.expenseCategory.update({
        where: { id: rent.id },
        data: { isActive: false },
      });
      await expect(
        w.money.recordExpense(
          w.admin,
          {
            categoryId: rent.id,
            amount: '10',
            note: 'Rent',
            paidFrom: 'OFFICE_CASH',
          },
          MONDAY,
        ),
      ).rejects.toMatchObject({
        code: 'EXPENSE_CATEGORY_RETIRED',
        status: 422,
      });

      await w.banks.update(w.owner, w.sbi.id, {
        name: 'SBI Mylapore',
        isActive: false,
      });
      await expect(
        w.money.recordOtherIncome(
          w.admin,
          { amount: '10', note: 'Fee', bankAccountId: w.sbi.id },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_RETIRED', status: 422 });

      expect(
        await tx.expense.count({ where: { organizationId: w.organizationId } }),
      ).toBe(0);
      expect(
        await tx.incomeEntry.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(0);
    });
  });

  it("will not pay from another organization's bank", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await moneyWorld(tx);
      const other = await moneyWorld(tx);
      await expect(
        w.money.recordDrawing(
          w.owner,
          { amount: '10', note: 'Not ours', bankAccountId: other.sbi.id },
          MONDAY,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
