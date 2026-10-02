import { postJournalBodySchema } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { BankAccountService } from '../../src/books/bank-account.service.js';
import { BooksMoneyService } from '../../src/books/books-money.service.js';
import { JournalService } from '../../src/books/journal.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { StatementsService } from '../../src/ledger/statements.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Books slice 5 (ADR-0018), rolled back: the Super Admin's manual journal.
 * Worked example: ₹500 of rent was booked as Miscellaneous, and the passbook
 * shows ₹50 of bank charges nobody recorded. Two journals put both right; the
 * profit and loss moves to match and the books still balance.
 */
describe('manual journal (ADR-0018)', () => {
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
    const banks = new BankAccountService(database, audit);
    const sbi = await banks.create(owner, { name: 'SBI Mylapore' });
    const category = (name: string) =>
      tx.expenseCategory.create({
        data: { organizationId: w.organizationId, name },
      });
    const rent = await category('Rent');
    const misc = await category('Miscellaneous');
    const charges = await category('Bank charges');
    await money.recordBankTransfer(
      w.admin,
      { toBankAccountId: sbi.id, amount: '5000', note: 'Deposit' },
      MONDAY,
    );
    await money.recordExpense(
      w.admin,
      {
        categoryId: misc.id,
        amount: '500',
        note: 'January rent',
        paidFrom: 'OFFICE_CASH',
      },
      MONDAY,
    );
    return {
      ...w,
      owner,
      banks,
      sbi,
      rent,
      misc,
      charges,
      journal: new JournalService(database, audit, ledger, money),
      statements: new StatementsService(database),
    };
  }

  it('reclassifies rent and records bank charges; the P&L moves and the books balance', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const fixed = await w.journal.post(
        w.owner,
        {
          note: 'January rent was booked as miscellaneous',
          lines: [
            {
              accountType: 'EXPENSE',
              categoryId: w.rent.id,
              direction: 'DEBIT',
              amount: '500',
            },
            {
              accountType: 'EXPENSE',
              categoryId: w.misc.id,
              direction: 'CREDIT',
              amount: '500',
            },
          ],
        },
        MONDAY,
      );
      expect(fixed).toMatchObject({
        businessDate: MONDAY,
        amount: '500.00',
        lines: [
          { name: 'Rent', direction: 'DEBIT', amount: '500.00' },
          { name: 'Miscellaneous', direction: 'CREDIT', amount: '500.00' },
        ],
        recordedBy: { userId: w.owner.userId },
      });
      await w.journal.post(
        w.owner,
        {
          note: 'Charges on the January passbook',
          lines: [
            {
              accountType: 'EXPENSE',
              categoryId: w.charges.id,
              direction: 'DEBIT',
              amount: '50',
            },
            {
              accountType: 'BANK',
              bankAccountId: w.sbi.id,
              direction: 'CREDIT',
              amount: '50',
            },
          ],
        },
        MONDAY,
      );

      const pnl = await w.statements.profitAndLoss(
        w.admin,
        { from: '2026-01-01', to: MONDAY },
        evening,
      );
      expect(pnl.expenses.categories).toEqual([
        { categoryId: w.rent.id, name: 'Rent', amount: '500.00' },
        { categoryId: w.charges.id, name: 'Bank charges', amount: '50.00' },
      ]);
      const sheet = await w.statements.balanceSheet(
        w.admin,
        { date: MONDAY },
        evening,
      );
      expect(sheet.balanced).toBe(true);
      expect(sheet.assets.banks).toEqual([
        { id: w.sbi.id, name: 'SBI Mylapore', balance: '4950.00' },
      ]);

      const posting = await tx.ledgerTransaction.findFirstOrThrow({
        where: { sourceTable: 'journal_entry', sourceId: fixed.id },
      });
      expect(posting.transactionType).toBe('JOURNAL');
      expect(
        await tx.auditLog.count({
          where: { entityTable: 'journal_entry', entityId: fixed.id },
        }),
      ).toBe(1);
      const listed = await w.journal.list(w.admin, { limit: 50 });
      expect(listed.total).toBe(2);
      // A Senior reads no journals.
      expect((await w.journal.list(w.senior, { limit: 50 })).total).toBe(0);
    });
  });

  it('refuses unbalanced lines, a future date, a retired category or bank, and writes nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const two = (amount: string) => [
        {
          accountType: 'CAPITAL' as const,
          direction: 'DEBIT' as const,
          amount: '100',
        },
        {
          accountType: 'CASH_AT_OFFICE' as const,
          direction: 'CREDIT' as const,
          amount,
        },
      ];
      await expect(
        w.journal.post(w.owner, { note: 'Off', lines: two('90') }, MONDAY),
      ).rejects.toMatchObject({ code: 'JOURNAL_NOT_BALANCED', status: 422 });
      await expect(
        w.journal.post(
          w.owner,
          { businessDate: '2026-01-06', note: 'Tomorrow', lines: two('100') },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'BOOKS_DATE_IN_FUTURE' });

      await tx.expenseCategory.update({
        where: { id: w.misc.id },
        data: { isActive: false },
      });
      await expect(
        w.journal.post(
          w.owner,
          {
            note: 'Into a retired category',
            lines: [
              {
                accountType: 'EXPENSE',
                categoryId: w.misc.id,
                direction: 'DEBIT',
                amount: '10',
              },
              {
                accountType: 'CASH_AT_OFFICE',
                direction: 'CREDIT',
                amount: '10',
              },
            ],
          },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_RETIRED' });

      const other = await cashWorld(tx);
      const theirs = await new BankAccountService(
        new Database(tx),
        new AuditWriter(new Database(tx)),
      ).create({ ...other.admin, role: 'SUPER_ADMIN' }, { name: 'Not ours' });
      await expect(
        w.journal.post(
          w.owner,
          {
            note: 'Another business’s bank',
            lines: [
              {
                accountType: 'BANK',
                bankAccountId: theirs.id,
                direction: 'DEBIT',
                amount: '10',
              },
              {
                accountType: 'CASH_AT_OFFICE',
                direction: 'CREDIT',
                amount: '10',
              },
            ],
          },
          MONDAY,
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(
        await tx.journalEntry.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('the contract cannot name cash in hand, a receivable or profit, and needs a debit and a credit', () => {
    for (const accountType of [
      'CASH_IN_HAND',
      'LOAN_RECEIVABLE',
      'UNEARNED_PROFIT',
      'EARNED_PROFIT',
    ]) {
      expect(
        postJournalBodySchema.safeParse({
          note: 'Nudge the loan book',
          lines: [
            { accountType, direction: 'DEBIT', amount: '10' },
            { accountType: 'CAPITAL', direction: 'CREDIT', amount: '10' },
          ],
        }).success,
      ).toBe(false);
    }
    const parsed = postJournalBodySchema.safeParse({
      note: 'All one side',
      lines: [
        { accountType: 'CAPITAL', direction: 'DEBIT', amount: '10' },
        { accountType: 'CASH_AT_OFFICE', direction: 'DEBIT', amount: '10' },
      ],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      'a journal needs at least one debit and one credit',
    );
  });
});
