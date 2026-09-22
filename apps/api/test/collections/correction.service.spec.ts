import type { PrismaClient } from '@repo/db';
import { openLinePeriod } from '../database.js';
import { parseCalendarDate } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { DayCloseService } from '../../src/cash/day-close.service.js';
import { HandoverViews } from '../../src/cash/handover-views.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * Corrections and approvals (M07, US-044, BR-14) against real rows, rolled
 * back. Adjustments and their ledger postings reject DELETE, so this tier is
 * where they are proven.
 *
 * Reference account: A 10,000 / I 8,500 / P 1,500 / D 100, day one Saturday
 * 3 January 2026. Collected Monday 5 January; corrections requested Tuesday 6,
 * decided Wednesday 7.
 */
describe('CorrectionService (US-044, BR-14)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const SATURDAY = parseCalendarDate('2026-01-03');
  const at = (date: string) => new Date(`${date}T10:00:00+05:30`);

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const organizationId = organization.id;
    const context = async (
      role: RequestContext['role'],
      currentLineId: string | null,
    ): Promise<RequestContext> => {
      const staff = await createStaff(
        tx,
        organizationId,
        role === 'JUNIOR' ? 'JUNIOR' : 'SENIOR',
      );
      return {
        requestId: 'req_test',
        userId: staff.userId,
        staffProfileId: staff.id,
        organizationId,
        role,
        currentLineId,
      };
    };
    const admin = await context('ADMIN', null);
    const secondAdmin = await context('ADMIN', null);
    const senior = await context('SENIOR', line.id);
    const junior = await context('JUNIOR', line.id);
    const otherJunior = await context('JUNIOR', line.id);

    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const settlement = new AccountSettlement(database);
    const { notices } = testNotifications(database);
    const dayCloses = new DayCloseService(
      database,
      audit,
      settlement,
      new HandoverViews(),
      notices,
    );
    const accounts = new AccountService(database, audit, ledger);
    const collections = new CollectionService(
      database,
      audit,
      ledger,
      { warn: () => undefined } as unknown as PinoLogger,
      settlement,
      dayCloses,
      notices,
    );
    const history = new CollectionHistoryService(database);
    const corrections = new CorrectionService(
      database,
      audit,
      ledger,
      settlement,
      history,
      dayCloses,
      notices,
    );

    const account = async (
      accountAmount = '10000',
      investedAmount = '8500',
    ) => {
      const customer = await tx.customer.create({
        data: {
          organizationId,
          customerCode: `C-${randomUUID()}`,
          name: 'Lakshmi',
          mobile: '+919800000001',
          address: '12 Market Road',
          sectorId: sector.id,
          lineId: line.id,
          linePeriods: openLinePeriod(line.id),
        },
      });
      return accounts.create(
        admin,
        {
          customerId: customer.id,
          accountAmount,
          investedAmount,
          dailyAmount: '100',
          termDays: 100,
          disbursementDate: SATURDAY,
          disburse: true,
        },
        SATURDAY,
      );
    };

    const collect = async (
      accountLoanId: string,
      amount: string,
      by: RequestContext = junior,
    ) =>
      (
        await collections.record(
          by,
          {
            idempotencyKey: randomUUID(),
            accountLoanId,
            amount,
            capturedAt: at('2026-01-05').toISOString(),
            note: undefined,
          },
          at('2026-01-05'),
        )
      ).collection;

    const balances = async () =>
      Object.fromEntries(
        (
          await tx.ledgerAccount.findMany({
            where: { organizationId, accountLoanId: null },
          })
        ).map((row) => [row.accountType, row.balance.toFixed(2)]),
      );

    const loan = (id: string) =>
      tx.accountLoan.findUniqueOrThrow({ where: { id } });

    return {
      admin,
      secondAdmin,
      senior,
      junior,
      otherJunior,
      account,
      collect,
      corrections,
      history,
      balances,
      loan,
    };
  }

  describe('Scenario: correction requires approval', () => {
    it('recorded 100, actually 80: the original is unchanged, an ADJUSTMENT of −20 waits, and nothing moves', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');
        const before = await w.balances();

        const requested = await w.corrections.request(
          w.junior,
          original.id,
          { correctedAmount: '80', reason: 'Counted a ₹20 note twice' },
          at('2026-01-06'),
        );

        expect(requested).toMatchObject({
          decision: 'PENDING',
          reason: 'Counted a ₹20 note twice',
          requestedByUserId: w.junior.userId,
          correctedAmount: '80.00',
          canDecide: false,
          original: { id: original.id, amount: '100.00', netAmount: '100.00' },
          adjustment: {
            entryType: 'ADJUSTMENT',
            status: 'PENDING_APPROVAL',
            adjustsCollectionId: original.id,
            amount: '-20.00',
            businessDate: '2026-01-06',
            collectedByUserId: w.junior.userId,
            classification: 'LOW',
          },
        });
        const stored = await tx.collection.findUniqueOrThrow({
          where: { id: original.id },
        });
        expect(stored.amount.toFixed(2)).toBe('100.00');
        expect((await w.loan(account.id)).outstandingAmount.toFixed(2)).toBe(
          '9900.00',
        );
        expect(await w.balances()).toEqual(before);
        expect(
          await tx.ledgerTransaction.count({
            where: {
              sourceTable: 'collection',
              sourceId: requested.adjustment.id,
            },
          }),
        ).toBe(0);
        // M10 notifications are not built: "my Senior is notified" is not asserted.
      });
    });

    it('refuses a correction that changes nothing, a second one while the first waits, and one that adds more than the outstanding', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account('1000', '850');
        const original = await w.collect(account.id, '100');

        await expect(
          w.corrections.request(w.junior, original.id, {
            correctedAmount: '100.00',
            reason: 'x',
          }),
        ).rejects.toMatchObject({ code: 'NO_CHANGE', status: 422 });
        // Outstanding is 900: correcting 100 up to 1,001 would add 901.
        await expect(
          w.corrections.request(w.junior, original.id, {
            correctedAmount: '1001',
            reason: 'x',
          }),
        ).rejects.toMatchObject({
          code: 'AMOUNT_EXCEEDS_OUTSTANDING',
          status: 422,
        });

        await w.corrections.request(w.junior, original.id, {
          correctedAmount: '90',
          reason: 'x',
        });
        await expect(
          w.corrections.request(w.senior, original.id, {
            correctedAmount: '80',
            reason: 'y',
          }),
        ).rejects.toMatchObject({ code: 'CORRECTION_PENDING', status: 409 });
      });
    });

    it("a Junior can correct only their own entries — another Junior's is 404, as for a missing one", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100', w.otherJunior);

        await expect(
          w.corrections.request(w.junior, original.id, {
            correctedAmount: '80',
            reason: 'x',
          }),
        ).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND', status: 404 });
        await expect(
          w.corrections.request(w.senior, original.id, {
            correctedAmount: '80',
            reason: 'x',
          }),
        ).resolves.toMatchObject({ decision: 'PENDING' });
      });
    });
  });

  describe('Scenario: approval applies the adjustment', () => {
    it('the Senior approves: CONFIRMED, outstanding up by 20, the ledger posts it, and both rows stay in history', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');
        const { id: approvalId, adjustment } = await w.corrections.request(
          w.junior,
          original.id,
          { correctedAmount: '80', reason: 'Counted a ₹20 note twice' },
          at('2026-01-06'),
        );

        const decided = await w.corrections.decide(
          w.senior,
          approvalId,
          { decision: 'APPROVED', note: 'Checked the paper note' },
          at('2026-01-07'),
        );

        expect(decided).toMatchObject({
          decision: 'APPROVED',
          decidedByName: expect.any(String),
          decisionNote: 'Checked the paper note',
          adjustment: { status: 'CONFIRMED', amount: '-20.00' },
          // The net it was asked against, and what it became.
          original: { netAmount: '100.00' },
          correctedAmount: '80.00',
        });
        const loan = await w.loan(account.id);
        expect(loan.collectedAmount.toFixed(2)).toBe('80.00');
        expect(loan.outstandingAmount.toFixed(2)).toBe('9920.00');
        // 9,920 at 100 a day: 100 slots after Wednesday 7 January.
        expect(
          await tx.accountSchedule.count({
            where: { accountLoanId: account.id, status: 'PENDING' },
          }),
        ).toBe(100);

        // BR-18 on the running total: 80 of 10,000 recognises ₹12.00, not ₹15.00.
        expect(await w.balances()).toMatchObject({
          CASH_IN_HAND: '80.00',
          UNEARNED_PROFIT: '1488.00',
          EARNED_PROFIT: '12.00',
        });
        const posting = await tx.ledgerTransaction.findFirstOrThrow({
          where: { sourceTable: 'collection', sourceId: adjustment.id },
        });
        expect(posting.transactionType).toBe('ADJUSTMENT');
        expect(posting.businessDate.toISOString().slice(0, 10)).toBe(
          '2026-01-06',
        );

        const detail = await w.history.get(w.senior, original.id);
        expect(detail).toMatchObject({
          amount: '100.00',
          netAmount: '80.00',
          canRequestCorrection: true,
          adjustments: [
            {
              id: adjustment.id,
              status: 'CONFIRMED',
              approval: { decision: 'APPROVED' },
            },
          ],
        });
      });
    });

    it('a correction upwards — recorded 80, actually 100 — reduces the outstanding and adds the cash', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '80');
        const { id } = await w.corrections.request(w.junior, original.id, {
          correctedAmount: '100',
          reason: 'Missed a ₹20 note',
        });
        await w.corrections.decide(w.admin, id, { decision: 'APPROVED' });

        expect((await w.loan(account.id)).outstandingAmount.toFixed(2)).toBe(
          '9900.00',
        );
        expect(await w.balances()).toMatchObject({
          CASH_IN_HAND: '100.00',
          EARNED_PROFIT: '15.00',
        });
      });
    });

    it('a reversal of the payment that completed an account reopens it with a new tail, and takes the cash and profit back', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account('1000', '850');
        const original = await w.collect(account.id, '1000');
        expect((await w.loan(account.id)).status).toBe('COMPLETED');

        const { id } = await w.corrections.reverse(
          w.admin,
          original.id,
          { reason: 'Recorded against the wrong customer' },
          at('2026-01-06'),
        );
        await w.corrections.decide(
          w.senior,
          id,
          { decision: 'APPROVED' },
          at('2026-01-07'),
        );

        const loan = await w.loan(account.id);
        expect(loan).toMatchObject({
          status: 'ACTIVE',
          actualCompletionDate: null,
        });
        expect(loan.outstandingAmount.toFixed(2)).toBe('1000.00');
        expect(
          await tx.accountSchedule.count({
            where: { accountLoanId: account.id, status: 'PENDING' },
          }),
        ).toBe(10);
        expect(await w.balances()).toMatchObject({
          CASH_IN_HAND: '0.00',
          UNEARNED_PROFIT: '150.00',
          EARNED_PROFIT: '0.00',
        });
      });
    });

    it('the outstanding is checked again at approval, and a decided correction cannot be decided twice', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account('1000', '850');
        const first = await w.collect(account.id, '100');
        const { id } = await w.corrections.request(w.junior, first.id, {
          correctedAmount: '600',
          reason: 'Paid ₹600 in advance',
        });
        // Meanwhile 500 more is collected: outstanding 400, and +500 no longer fits.
        await w.collect(account.id, '500');
        await expect(
          w.corrections.decide(w.senior, id, { decision: 'APPROVED' }),
        ).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDS_OUTSTANDING' });

        await w.corrections.decide(w.senior, id, { decision: 'REJECTED' });
        await expect(
          w.corrections.decide(w.admin, id, { decision: 'APPROVED' }),
        ).rejects.toMatchObject({
          code: 'APPROVAL_ALREADY_DECIDED',
          status: 409,
        });
      });
    });
  });

  describe('Scenario: who may decide their own request', () => {
    it('a Senior may approve the correction they requested, and it settles as any other', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');

        const own = await w.corrections.request(w.senior, original.id, {
          correctedAmount: '80',
          reason: 'x',
        });
        expect(own.canDecide).toBe(true);
        await expect(
          w.corrections.decide(w.senior, own.id, { decision: 'APPROVED' }),
        ).resolves.toMatchObject({ decision: 'APPROVED' });
      });
    });

    it('a Senior may reject the correction they requested', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');

        const own = await w.corrections.request(w.senior, original.id, {
          correctedAmount: '80',
          reason: 'x',
        });
        await expect(
          w.corrections.decide(w.senior, own.id, { decision: 'REJECTED' }),
        ).resolves.toMatchObject({ decision: 'REJECTED' });
      });
    });

    it('an Admin cannot approve their own reversal; a second Admin can', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');

        const reversal = await w.corrections.reverse(w.admin, original.id, {
          reason: 'x',
        });
        expect(reversal.canDecide).toBe(false);
        await expect(
          w.corrections.decide(w.admin, reversal.id, { decision: 'APPROVED' }),
        ).rejects.toMatchObject({ code: 'SELF_APPROVAL', status: 403 });
        await expect(
          w.corrections.decide(w.secondAdmin, reversal.id, {
            decision: 'APPROVED',
          }),
        ).resolves.toMatchObject({ decision: 'APPROVED' });
      });
    });
  });

  describe('rejection and history', () => {
    it('a rejected correction ends REJECTED, moves nothing, stays visible, and frees the collection for another request', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const original = await w.collect(account.id, '100');
        const before = await w.balances();
        const { id, adjustment } = await w.corrections.request(
          w.junior,
          original.id,
          {
            correctedAmount: '0',
            reason: 'x',
          },
        );

        await w.corrections.decide(w.senior, id, {
          decision: 'REJECTED',
          note: 'The customer confirms 100',
        });

        expect(await w.balances()).toEqual(before);
        expect((await w.loan(account.id)).outstandingAmount.toFixed(2)).toBe(
          '9900.00',
        );
        const detail = await w.history.get(w.junior, original.id);
        expect(detail).toMatchObject({
          netAmount: '100.00',
          adjustments: [
            {
              id: adjustment.id,
              status: 'REJECTED',
              approval: { decision: 'REJECTED' },
            },
          ],
        });
        await expect(
          w.corrections.request(w.junior, original.id, {
            correctedAmount: '90',
            reason: 'y',
          }),
        ).resolves.toMatchObject({ decision: 'PENDING' });
      });
    });

    it('lists history newest first by business date, in scope, and the approval queue shows who may decide', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const mine = await w.collect(account.id, '100');
        const other = await w.account();
        await w.collect(other.id, '100', w.otherJunior);
        await w.corrections.request(
          w.junior,
          mine.id,
          { correctedAmount: '80', reason: 'x' },
          at('2026-01-06'),
        );

        const range = { from: '2026-01-05', to: '2026-01-06', limit: 50 };
        const juniorSees = await w.history.list(w.junior, range);
        expect(
          juniorSees.data.map((row) => [row.entryType, row.amount]),
        ).toEqual([
          // Newest first (US-045): the correction was made the day after the
          // collection it adjusts.
          ['ADJUSTMENT', '-20.00'],
          ['ORIGINAL', '100.00'],
        ]);
        expect((await w.history.list(w.senior, range)).data).toHaveLength(3);
        await expect(
          w.history.list(w.senior, {
            from: '2026-01-06',
            to: '2026-01-05',
            limit: 50,
          }),
        ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });

        const queue = await w.corrections.listApprovals(w.senior, {
          decision: 'PENDING',
          limit: 50,
        });
        expect(queue.data).toHaveLength(1);
        expect(queue.data[0]).toMatchObject({
          canDecide: true,
          correctedAmount: '80.00',
        });
      });
    });
  });
});
