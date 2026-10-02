import type { PrismaClient } from '@repo/db';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { BankAccountService } from '../../src/books/bank-account.service.js';
import { ExpenseCategoryService } from '../../src/books/expense-category.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { TrialBalanceService } from '../../src/ledger/trial-balance.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Books slice 1 (ADR-0018), rolled back: expense categories, bank accounts,
 * and the ledger accounts keyed to them.
 */
describe('books foundation (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function booksWorld(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
    return {
      ...w,
      database,
      ledger,
      owner,
      categories: new ExpenseCategoryService(database, audit),
      banks: new BankAccountService(database, audit),
      trial: new TrialBalanceService(database),
    };
  }

  describe('expense categories', () => {
    it('lets every role read the categories to pick one, and audits each one added', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const rent = await w.categories.create(w.owner, { name: 'Shop rent' });
        expect(rent).toMatchObject({ name: 'Shop rent', isActive: true });

        const seen = await w.categories.list(w.junior, {
          includeRetired: false,
        });
        expect(seen.data.map((row) => row.name)).toContain('Shop rent');

        const audit = await tx.auditLog.findMany({
          where: { entityTable: 'expense_category', entityId: rent.id },
        });
        expect(audit.map((row) => row.action)).toEqual(['CREATE']);
      });
    });

    it('refuses a second category of the same name, whatever its case or spacing', async () => {
      // A refused insert aborts the rolled-back transaction, so the refusal
      // is what the whole block rejects with.
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await booksWorld(tx);
          await w.categories.create(w.owner, { name: 'Shop rent' });
          await w.categories.create(w.owner, { name: '  SHOP RENT ' });
        }),
      ).rejects.toMatchObject({
        code: 'EXPENSE_CATEGORY_NAME_TAKEN',
        status: 409,
      });
    });

    it('retires a category rather than deleting it: gone from the pick list, kept when asked for', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const tea = await w.categories.create(w.owner, { name: 'Tea' });
        await w.categories.update(w.owner, tea.id, {
          name: 'Tea & snacks',
          isActive: false,
        });

        const active = await w.categories.list(w.admin, {
          includeRetired: false,
        });
        expect(active.data.map((row) => row.name)).not.toContain(
          'Tea & snacks',
        );
        const all = await w.categories.list(w.admin, { includeRetired: true });
        expect(all.data.find((row) => row.id === tea.id)).toMatchObject({
          name: 'Tea & snacks',
          isActive: false,
        });
      });
    });

    it("never shows or changes another organization's category", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const other = await booksWorld(tx);
        const theirs = await other.categories.create(other.owner, {
          name: 'Their rent',
        });

        const ours = await w.categories.list(w.admin, { includeRetired: true });
        expect(ours.data.map((row) => row.id)).not.toContain(theirs.id);
        await expect(
          w.categories.update(w.owner, theirs.id, {
            name: 'Taken',
            isActive: true,
          }),
        ).rejects.toMatchObject({ status: 404 });
      });
    });
  });

  describe('bank accounts', () => {
    it('lists the banks with their balance for an Admin, and none for a Senior', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const sbi = await w.banks.create(w.owner, {
          name: 'SBI Mylapore',
          last4: '4321',
        });
        expect(sbi).toMatchObject({ last4: '4321', balance: '0.00' });

        const admin = await w.banks.list(w.admin, { includeRetired: false });
        expect(admin.data.map((row) => row.name)).toEqual(['SBI Mylapore']);
        const senior = await w.banks.list(w.senior, { includeRetired: false });
        expect(senior.data).toEqual([]);
      });
    });

    it('will not retire a bank that still holds money, and will once it is empty', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const sbi = await w.banks.create(w.owner, { name: 'SBI Mylapore' });
        const bankLedger = await w.ledger.bankAccount(w.organizationId, sbi.id);
        const office = await w.ledger.organizationAccount(
          w.organizationId,
          'CASH_AT_OFFICE',
        );
        const move = (from: string, to: string, amount: string) =>
          w.database.transaction(() =>
            w.ledger.post(w.owner, {
              transactionType: 'BANK_TRANSFER',
              source: { table: 'bank_account', id: sbi.id },
              businessDate: MONDAY,
              eventAt: new Date(),
              description: 'Test movement',
              lines: [
                { ledgerAccountId: to, direction: 'DEBIT', amount },
                { ledgerAccountId: from, direction: 'CREDIT', amount },
              ],
            }),
          );
        await move(office, bankLedger, '5000.00');
        expect(
          (await w.banks.list(w.admin, { includeRetired: false })).data[0],
        ).toMatchObject({ balance: '5000.00' });

        await expect(
          w.banks.update(w.owner, sbi.id, {
            name: 'SBI Mylapore',
            isActive: false,
          }),
        ).rejects.toMatchObject({
          code: 'BANK_ACCOUNT_HAS_BALANCE',
          status: 422,
        });

        await move(bankLedger, office, '5000.00');
        await expect(
          w.banks.update(w.owner, sbi.id, {
            name: 'SBI Mylapore',
            isActive: false,
          }),
        ).resolves.toMatchObject({ isActive: false, balance: '0.00' });
      });
    });
  });

  describe('keyed ledger accounts', () => {
    it('creates one EXPENSE account per category and one BANK account per bank, however often asked', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const rent = await w.categories.create(w.owner, { name: 'Shop rent' });
        const sbi = await w.banks.create(w.owner, { name: 'SBI Mylapore' });

        const first = await w.ledger.expenseAccount(w.organizationId, rent.id);
        expect(await w.ledger.expenseAccount(w.organizationId, rent.id)).toBe(
          first,
        );
        const bank = await w.ledger.bankAccount(w.organizationId, sbi.id);
        expect(await w.ledger.bankAccount(w.organizationId, sbi.id)).toBe(bank);
        expect(
          await tx.ledgerAccount.findUniqueOrThrow({ where: { id: first } }),
        ).toMatchObject({ accountType: 'EXPENSE', normalBalance: 'DEBIT' });
      });
    });

    it('shows each expense category and bank as its own named row in the trial balance', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await booksWorld(tx);
        const rent = await w.categories.create(w.owner, { name: 'Shop rent' });
        const sbi = await w.banks.create(w.owner, { name: 'SBI Mylapore' });
        const office = await w.ledger.organizationAccount(
          w.organizationId,
          'CASH_AT_OFFICE',
        );
        const expense = await w.ledger.expenseAccount(
          w.organizationId,
          rent.id,
        );
        const bank = await w.ledger.bankAccount(w.organizationId, sbi.id);
        await w.database.transaction(() =>
          w.ledger.post(w.owner, {
            transactionType: 'EXPENSE',
            source: { table: 'expense_category', id: rent.id },
            businessDate: MONDAY,
            eventAt: new Date(),
            description: 'Rent paid from the bank',
            lines: [
              {
                ledgerAccountId: expense,
                direction: 'DEBIT',
                amount: '3000.00',
              },
              { ledgerAccountId: bank, direction: 'CREDIT', amount: '3000.00' },
            ],
          }),
        );
        await w.database.transaction(() =>
          w.ledger.post(w.owner, {
            transactionType: 'BANK_TRANSFER',
            source: { table: 'bank_account', id: sbi.id },
            businessDate: MONDAY,
            eventAt: new Date(),
            description: 'Deposit',
            lines: [
              { ledgerAccountId: bank, direction: 'DEBIT', amount: '10000.00' },
              {
                ledgerAccountId: office,
                direction: 'CREDIT',
                amount: '10000.00',
              },
            ],
          }),
        );

        const trial = await w.trial.trialBalance(w.admin, { date: MONDAY });
        expect(trial.balanced).toBe(true);
        expect(
          trial.rows
            .filter(
              (row) =>
                row.accountType === 'EXPENSE' || row.accountType === 'BANK',
            )
            .map((row) => [
              row.accountType,
              row.referenceName,
              row.debitBalance,
            ]),
        ).toEqual([
          ['BANK', 'SBI Mylapore', '7000.00'],
          ['EXPENSE', 'Shop rent', '3000.00'],
        ]);
      });
    });
  });
});
