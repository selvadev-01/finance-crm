import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { TrialBalanceService } from '../../src/ledger/trial-balance.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld, MONDAY, SATURDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * M09's trial balance from the entries, rolled back. The worked example: the
 * owner puts in ₹1,700 and a ₹100-a-day account (A 2,000 · I 1,700 · P 300) is
 * disbursed from it Saturday, ₹100 collected Monday (₹15 profit earned,
 * BR-18), ₹5,000 more capital on Monday.
 */
describe('TrialBalanceService (M09)', () => {
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
    return { ...w, trial: new TrialBalanceService(database) };
  }

  const summary = (
    rows: {
      accountType: string;
      debitBalance: string;
      creditBalance: string;
    }[],
  ) =>
    rows.map((row) => [row.accountType, row.debitBalance, row.creditBalance]);

  it('states every account on its normal side, and debits equal credits', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      const trial = await w.trial.trialBalance(w.admin, { date: MONDAY });

      expect(summary(trial.rows)).toEqual([
        ['CASH_AT_OFFICE', '5000.00', '0.00'],
        ['CASH_IN_HAND', '100.00', '0.00'],
        ['LOAN_RECEIVABLE', '1900.00', '0.00'],
        ['CAPITAL', '0.00', '6700.00'],
        ['UNEARNED_PROFIT', '0.00', '285.00'],
        ['EARNED_PROFIT', '0.00', '15.00'],
      ]);
      expect(trial.totals).toEqual({
        debitBalance: '7000.00',
        creditBalance: '7000.00',
      });
      expect(trial.balanced).toBe(true);

      // Cash in hand is named for whoever holds it; receivables are counted.
      const hand = trial.rows.find((row) => row.accountType === 'CASH_IN_HAND');
      expect(hand).toMatchObject({ ownerUserId: w.junior.userId, accounts: 1 });
      expect(hand!.ownerName).toBeTruthy();
      const receivable = trial.rows.find(
        (row) => row.accountType === 'LOAN_RECEIVABLE',
      );
      expect(receivable).toMatchObject({
        ownerUserId: null,
        accounts: 1,
        debits: '2000.00',
        credits: '100.00',
      });
    });
  });

  it('as of an earlier date leaves out what was posted after it', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      const trial = await w.trial.trialBalance(w.admin, { date: SATURDAY });

      expect(summary(trial.rows)).toEqual([
        // The ₹1,700 put in went straight out as the loan.
        ['CASH_AT_OFFICE', '0.00', '0.00'],
        ['LOAN_RECEIVABLE', '2000.00', '0.00'],
        ['CAPITAL', '0.00', '1700.00'],
        ['UNEARNED_PROFIT', '0.00', '300.00'],
      ]);
      expect(trial).toMatchObject({
        asOf: SATURDAY,
        totals: { debitBalance: '2000.00', creditBalance: '2000.00' },
        balanced: true,
      });
    });
  });

  it('is read from the entries, not the balance caches', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      // A drifted cache — what the nightly reconciliation exists to catch.
      await tx.ledgerAccount.updateMany({
        where: { organizationId: w.organizationId, accountType: 'CAPITAL' },
        data: { balance: '1.00' },
      });

      const trial = await w.trial.trialBalance(w.admin, { date: MONDAY });
      expect(
        trial.rows.find((row) => row.accountType === 'CAPITAL')?.creditBalance,
      ).toBe('6700.00');
    });
  });

  it("shows an Admin only their own organization's ledger, and a Senior nothing", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await ledgerWorld(tx);
      const other = await ledgerWorld(tx);

      const ours = await w.trial.trialBalance(w.admin, { date: MONDAY });
      const theirs = await other.trial.trialBalance(other.admin, {
        date: MONDAY,
      });
      // Each is its own 7,000 — never the two organizations summed.
      expect(ours.totals.debitBalance).toBe('7000.00');
      expect(theirs.totals.debitBalance).toBe('7000.00');

      const senior = await w.trial.trialBalance(w.senior, {
        date: parseCalendarDate('2026-01-05'),
      });
      expect(senior).toMatchObject({ rows: [], balanced: true });
    });
  });
});
