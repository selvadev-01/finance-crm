import type { PrismaClient } from '@repo/db';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { BankAccountService } from '../../src/books/bank-account.service.js';
import { BooksMoneyService } from '../../src/books/books-money.service.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { StatementsService } from '../../src/ledger/statements.service.js';
import { TrialBalanceService } from '../../src/ledger/trial-balance.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Books slice 4 (ADR-0018), rolled back: profit and loss, the balance sheet
 * and account statements from one worked example, to the paisa — and the
 * balance sheet's two sides equal, as the ledger guarantees.
 *
 * Saturday 3 January: the owner puts in ₹1,700 and an account of ₹2,000
 * (₹1,700 lent, ₹300 profit) is disbursed from it — a loan is paid only from
 * money put in (decided 2026-10-02). Monday 5 January: ₹10,000 capital; ₹100
 * collected (₹15 of it profit, BR-18); rent ₹3,000 from office cash; ₹200
 * other income; the owner draws ₹1,000; ₹5,000 is deposited in the bank.
 */
describe('statements (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const evening = at('2026-01-05', '20:00:00');

  async function world(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
    const money = new BooksMoneyService(database, audit, ledger);
    const statements = new StatementsService(database);
    const sbi = await new BankAccountService(database, audit).create(owner, {
      name: 'SBI Mylapore',
    });
    const rent = await tx.expenseCategory.create({
      data: { organizationId: w.organizationId, name: 'Rent' },
    });

    const account = await w.account('100');
    await new CapitalService(database, audit, ledger).add(
      owner,
      { amount: '10000', note: 'Opening capital' },
      MONDAY,
    );
    await w.collect(account.id, '100');
    await money.recordExpense(
      w.admin,
      {
        categoryId: rent.id,
        amount: '3000',
        note: 'January rent',
        paidFrom: 'OFFICE_CASH',
      },
      MONDAY,
    );
    await money.recordOtherIncome(
      w.admin,
      { amount: '200', note: 'Processing fee' },
      MONDAY,
    );
    await money.recordDrawing(
      owner,
      { amount: '1000', note: 'For home' },
      MONDAY,
    );
    await money.recordBankTransfer(
      w.admin,
      { toBankAccountId: sbi.id, amount: '5000', note: 'Deposit' },
      MONDAY,
    );
    return { ...w, statements, sbi, rent, ledger, database };
  }

  it('profit and loss: ₹15 earned + ₹200 other income − ₹3,000 rent = a ₹2,785 loss', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const pnl = await w.statements.profitAndLoss(
        w.admin,
        { from: '2026-01-01', to: MONDAY },
        evening,
      );
      expect(pnl).toMatchObject({
        income: {
          earnedProfit: '15.00',
          otherIncome: '200.00',
          total: '215.00',
        },
        expenses: {
          categories: [
            { categoryId: w.rent.id, name: 'Rent', amount: '3000.00' },
          ],
          writeOffLoss: '0.00',
          total: '3000.00',
        },
        netProfit: '-2785.00',
      });
      // Saturday has only the disbursement: lending is not profit or loss.
      const saturday = await w.statements.profitAndLoss(
        w.admin,
        { from: '2026-01-03', to: '2026-01-03' },
        evening,
      );
      expect(saturday.netProfit).toBe('0.00');
    });
  });

  it('balance sheet: ₹7,915 of assets against ₹11,700 − ₹1,000 − ₹2,785, and it balances', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const sheet = await w.statements.balanceSheet(
        w.admin,
        { date: MONDAY },
        evening,
      );
      expect(sheet).toMatchObject({
        assets: {
          officeCash: '1200.00',
          banks: [{ id: w.sbi.id, name: 'SBI Mylapore', balance: '5000.00' }],
          cashWithStaff: [{ id: w.junior.userId, balance: '100.00' }],
          loansReceivable: '1900.00',
          unearnedProfit: '285.00',
          total: '7915.00',
        },
        equity: {
          capital: '11700.00',
          drawings: '1000.00',
          retainedProfit: '-2785.00',
          total: '7915.00',
        },
        balanced: true,
      });
      // Retained profit is the P&L since the books began.
      const pnl = await w.statements.profitAndLoss(
        w.admin,
        { from: '2026-01-01', to: MONDAY },
        evening,
      );
      expect(sheet.equity.retainedProfit).toBe(pnl.netProfit);
    });
  });

  it('the cash book of office cash runs from ₹0 to ₹1,200, and the bank to ₹5,000', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const monday = await w.statements.cashBook(
        w.admin,
        { from: MONDAY, to: MONDAY },
        evening,
      );
      expect(monday).toMatchObject({
        account: { name: 'Cash in hand', normalBalance: 'DEBIT' },
        opening: '0.00',
        totals: { debits: '10200.00', credits: '9000.00' },
        closing: '1200.00',
      });
      expect(monday.entries).toHaveLength(5);
      expect(monday.entries.at(-1)!.balance).toBe('1200.00');

      const bank = await w.statements.cashBook(
        w.admin,
        { from: MONDAY, to: MONDAY, bankAccountId: w.sbi.id },
        evening,
      );
      expect(bank).toMatchObject({
        account: { name: 'SBI Mylapore' },
        opening: '0.00',
        closing: '5000.00',
      });

      // Any account opens by id from the trial balance; credit-normal reads positive.
      const trial = await new TrialBalanceService(w.database).trialBalance(
        w.admin,
        { date: MONDAY },
      );
      const capital = trial.rows.find((row) => row.accountType === 'CAPITAL')!;
      const statement = await w.statements.accountStatement(
        w.admin,
        capital.ledgerAccountId!,
        { from: MONDAY, to: MONDAY },
        evening,
      );
      expect(statement).toMatchObject({
        account: { name: 'Capital', normalBalance: 'CREDIT' },
        // Saturday's ₹1,700 and Monday's ₹10,000.
        closing: '11700.00',
      });
      expect(
        trial.rows.find((row) => row.accountType === 'LOAN_RECEIVABLE')
          ?.ledgerAccountId,
      ).toBeTruthy();
    });
  });

  it('reading the cash book of a place nothing moved through creates nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      const database = new Database(tx);
      const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
      const idle = await new BankAccountService(
        database,
        new AuditWriter(database),
      ).create(owner, { name: 'IOB Triplicane' });
      const statements = new StatementsService(database);
      const before = await tx.ledgerAccount.count({
        where: { organizationId: w.organizationId },
      });

      for (const query of [{}, { bankAccountId: idle.id }]) {
        expect(
          await statements.cashBook(w.admin, query, evening),
        ).toMatchObject({
          account: { ledgerAccountId: null },
          opening: '0.00',
          entries: [],
          closing: '0.00',
        });
      }
      expect(
        await tx.ledgerAccount.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(before);
    });
  });

  it("refuses a future date, a range over a year, another organization's account, and a Senior", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      await expect(
        w.statements.profitAndLoss(w.admin, { to: '2026-01-06' }, evening),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
      await expect(
        w.statements.profitAndLoss(
          w.admin,
          { from: '2025-01-01', to: MONDAY },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });

      const other = await cashWorld(tx);
      const theirs = await w.ledger.organizationAccount(
        other.organizationId,
        'CASH_AT_OFFICE',
      );
      await expect(
        w.statements.accountStatement(w.admin, theirs, {}, evening),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        w.statements.cashBook(w.senior, {}, evening),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await w.statements.balanceSheet(w.senior, {}, evening)).assets.total,
      ).toBe('0.00');
    });
  });
});
