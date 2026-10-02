import type { PrismaClient } from '@repo/db';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerTransactionsService } from '../../src/ledger/ledger-transactions.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld, MONDAY, SATURDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * M09 "view transactions and entries", rolled back: the owner puts in ₹1,700
 * and a ₹100-a-day account (A 2,000 · I 1,700 · P 300) is disbursed from it
 * Saturday, ₹100 collected Monday, and ₹5,000 more capital on Monday.
 */
describe('LedgerTransactionsService (M09)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function ledgerWorld(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const capital = new CapitalService(
      database,
      new AuditWriter(database),
      new LedgerService(database),
    );
    const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
    const account = await w.account('100', 'Meenakshi');
    await w.collect(account.id, '100');
    await capital.add(
      owner,
      { amount: '5000', note: 'Opening capital' },
      MONDAY,
    );
    return {
      ...w,
      account,
      transactions: new LedgerTransactionsService(database),
    };
  }

  const WEEK = { from: SATURDAY, to: MONDAY, limit: 50 };

  it('lists every posting newest first, each with its entries debits first and its amount', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      const page = await w.transactions.list(w.admin, WEEK);

      expect(page.total).toBe(4);
      expect(page.data.map((row) => [row.transactionType, row.amount])).toEqual(
        [
          ['CAPITAL', '5000.00'],
          ['COLLECTION', '115.00'],
          ['DISBURSEMENT', '2000.00'],
          // Put in before the loan, which was paid out of it.
          ['CAPITAL', '1700.00'],
        ],
      );

      const disbursement = page.data[2]!;
      expect(disbursement).toMatchObject({
        businessDate: SATURDAY,
        sourceTable: 'account_loan',
        sourceId: w.account.id,
      });
      expect(
        disbursement.entries.map((entry) => [
          entry.direction,
          entry.accountType,
          entry.amount,
        ]),
      ).toEqual([
        ['DEBIT', 'LOAN_RECEIVABLE', '2000.00'],
        ['CREDIT', 'CASH_AT_OFFICE', '1700.00'],
        ['CREDIT', 'UNEARNED_PROFIT', '300.00'],
      ]);
      expect(disbursement.entries[0]).toMatchObject({
        accountLoanId: w.account.id,
        accountCode: w.account.accountCode,
      });

      // The collection's cash is the Junior's, by name; profit moves with it (BR-18).
      const collection = page.data[1]!;
      const hand = collection.entries.find(
        (entry) => entry.accountType === 'CASH_IN_HAND',
      );
      expect(hand).toMatchObject({ direction: 'DEBIT', amount: '100.00' });
      expect(hand!.ownerName).toBeTruthy();
      expect(collection.createdByName).toBeTruthy();
    });
  });

  it('filters by type and by date, and pages without repeating a posting', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);

      const capital = await w.transactions.list(w.admin, {
        ...WEEK,
        type: 'CAPITAL',
      });
      expect(capital.data.map((row) => row.transactionType)).toEqual([
        'CAPITAL',
        'CAPITAL',
      ]);

      const saturday = await w.transactions.list(w.admin, {
        from: SATURDAY,
        to: SATURDAY,
        limit: 50,
      });
      expect(saturday.data.map((row) => row.transactionType)).toEqual([
        'DISBURSEMENT',
        'CAPITAL',
      ]);

      const first = await w.transactions.list(w.admin, { ...WEEK, limit: 2 });
      expect(first.hasMore).toBe(true);
      const second = await w.transactions.list(w.admin, {
        ...WEEK,
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(
        [...first.data, ...second.data].map((row) => row.transactionType),
      ).toEqual(['CAPITAL', 'COLLECTION', 'DISBURSEMENT', 'CAPITAL']);
      expect(second.hasMore).toBe(false);
    });
  });

  it("shows an Admin only their own organization's postings, and a Senior none", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      await ledgerWorld(tx);

      expect((await w.transactions.list(w.admin, WEEK)).total).toBe(4);
      expect(await w.transactions.list(w.senior, WEEK)).toMatchObject({
        data: [],
        total: 0,
      });
    });
  });
});
