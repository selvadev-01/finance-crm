import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { cashWorld, MONDAY } from './world.js';

/**
 * US-032 capital (decided 2026-09-24), against real rows, rolled back. Tier 1
 * only: `capital_entry` and the ledger are append-only, so no HTTP test may
 * write one.
 */
describe('CapitalService (US-032)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function capitalWorld(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const capital = new CapitalService(
      database,
      new AuditWriter(database),
      new LedgerService(database),
    );
    const owner: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
    return { ...w, capital, owner };
  }

  it('funds office cash: the owner puts in ₹1,700 and lends it out, leaving ₹0; ₹50,000 more leaves ₹50,000 at the office', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await capitalWorld(tx);
      // A ₹100-a-day account over 20 days invests ₹1,700 (BR-18): the owner
      // puts that in first, and the loan pays all of it out.
      await w.account('100');
      expect((await w.cash(w.admin.userId)).office).toBe('0.00');

      const entry = await w.capital.add(
        w.owner,
        { amount: '50000', note: 'Owner’s savings' },
        MONDAY,
      );
      expect(entry).toMatchObject({
        amount: '50000.00',
        businessDate: MONDAY,
        note: 'Owner’s savings',
        addedBy: { userId: w.owner.userId },
      });
      expect((await w.cash(w.admin.userId)).office).toBe('50000.00');

      const posting = await tx.ledgerTransaction.findFirstOrThrow({
        where: { sourceTable: 'capital_entry', sourceId: entry.id },
        include: { entries: { include: { ledgerAccount: true } } },
      });
      expect(posting.transactionType).toBe('CAPITAL');
      expect(
        posting.entries
          .map((line) => [
            line.ledgerAccount.accountType,
            line.direction,
            line.amount.toFixed(2),
          ])
          .sort(),
      ).toEqual([
        ['CAPITAL', 'CREDIT', '50000.00'],
        ['CASH_AT_OFFICE', 'DEBIT', '50000.00'],
      ]);
      const capitalAccount = await tx.ledgerAccount.findFirstOrThrow({
        where: { organizationId: w.organizationId, accountType: 'CAPITAL' },
      });
      expect(capitalAccount.balance.toFixed(2)).toBe('51700.00');

      const audit = await tx.auditLog.findMany({
        where: { entityTable: 'capital_entry', entityId: entry.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'CREATE',
        actorUserId: w.owner.userId,
      });
    });
  });

  it('lists entries newest first with the total put in and office cash now', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await capitalWorld(tx);
      await w.account('100');
      await w.capital.add(
        w.owner,
        { amount: '20000', note: 'Opening capital' },
        MONDAY,
      );
      await w.capital.add(
        w.owner,
        { amount: '5000.50', note: 'Top-up from gold loan' },
        MONDAY,
      );

      const page = await w.capital.list(w.admin, { limit: 50 });
      // The first entry is the ₹1,700 the loan needed, put in before it.
      expect(page.data.map((row) => row.note)).toEqual([
        'Top-up from gold loan',
        'Opening capital',
        'Test: funds the next loan',
      ]);
      expect(page).toMatchObject({
        total: 3,
        hasMore: false,
        totalCapital: '26700.50',
        officeCash: '25000.50',
      });
    });
  });

  it('records a past day as that business date, and refuses a future one before writing anything', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await capitalWorld(tx);
      const past = await w.capital.add(
        w.owner,
        {
          amount: '1000',
          businessDate: '2026-01-02',
          note: 'Brought in Friday',
        },
        MONDAY,
      );
      const posting = await tx.ledgerTransaction.findFirstOrThrow({
        where: { sourceTable: 'capital_entry', sourceId: past.id },
      });
      expect(posting.businessDate.toISOString().slice(0, 10)).toBe(
        '2026-01-02',
      );

      await expect(
        w.capital.add(
          w.owner,
          { amount: '1000', businessDate: '2026-01-06', note: 'Tomorrow' },
          MONDAY,
        ),
      ).rejects.toMatchObject({ code: 'CAPITAL_DATE_IN_FUTURE', status: 422 });
      expect(
        await tx.capitalEntry.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(1);
    });
  });

  it('shows a Senior nothing, and an Admin only their own organization’s capital', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await capitalWorld(tx);
      const elsewhere = await capitalWorld(tx);
      await w.capital.add(
        w.owner,
        { amount: '1000', note: 'Ours' },
        parseCalendarDate('2026-01-05'),
      );
      await elsewhere.capital.add(
        elsewhere.owner,
        { amount: '9000', note: 'Theirs' },
        parseCalendarDate('2026-01-05'),
      );

      const ours = await w.capital.list(w.admin, { limit: 50 });
      expect(ours.data.map((row) => row.note)).toEqual(['Ours']);
      expect(ours.totalCapital).toBe('1000.00');
      const senior = await w.capital.list(w.senior, { limit: 50 });
      expect(senior).toMatchObject({ data: [], total: 0 });
    });
  });
});
