import type { PrismaClient } from '@repo/db';
import { fundOfficeCash } from './fund-office-cash.js';
import { openLinePeriod } from '../database.js';
import { testNotifications } from '../notifications/notices.js';
import { dayOfWeek, parseCalendarDate } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * Account creation and disbursement (M05, US-030, US-031, US-032) against real
 * rows, rolled back — the only tier that may write the ledger, which rejects
 * DELETE. withRollback fires the deferred balancing trigger before rolling
 * back, so an unbalanced posting fails here.
 */
describe('AccountService (US-030, US-031, US-032)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Saturday 3 January 2026 — the US-030 preview scenario's disbursement day. */
  const SATURDAY = parseCalendarDate('2026-01-03');

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const organizationId = organization.id;
    const admin = await createStaff(tx, organizationId, 'SENIOR');
    const context: RequestContext = {
      requestId: 'req_test',
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId,
      role: 'ADMIN',
      currentLineIds: [],
    };
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
    const database = new Database(tx);
    const service = new AccountService(
      database,
      new AuditWriter(database),
      new LedgerService(database),
      testNotifications(database).notices,
    );
    const terms = (overrides: object = {}) => ({
      customerId: customer.id,
      accountAmount: '10000',
      investedAmount: '8500',
      dailyAmount: '100',
      termDays: 100,
      collectionFrequency: 'DAILY' as const,
      disbursementDate: SATURDAY,
      disburse: false,
      ...overrides,
    });
    // Only the Super Admin pays a loan out, from money already put in
    // (decided 2026-10-02); `fund` is the owner adding that capital first.
    const owner: RequestContext = { ...context, role: 'SUPER_ADMIN' };
    const fund = (amount = '8500') =>
      fundOfficeCash(database, owner, amount, SATURDAY);
    return {
      organizationId,
      sector,
      line,
      context,
      owner,
      fund,
      customer,
      service,
      terms,
    };
  }

  const sum = (values: string[]) =>
    values.reduce((total, value) => total + BigInt(value.replace('.', '')), 0n);

  describe('Scenario: Schedule preview (US-030)', () => {
    it('Saturday 3 January → first collection Monday 5 January, 100 slots, no Sunday, summing to exactly 10,000', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const preview = await service.preview(context, terms(), SATURDAY);

        expect(preview.profitAmount).toBe('1500.00');
        expect(preview.firstCollectionDate).toBe('2026-01-05');
        expect(preview.slotCount).toBe(100);
        expect(preview.slots).toHaveLength(100);
        expect(
          preview.slots.some(
            (slot) => dayOfWeek(parseCalendarDate(slot.dueDate)) === 0,
          ),
        ).toBe(false);
        expect(sum(preview.slots.map((slot) => slot.expectedAmount))).toBe(
          1_000_000n,
        );
        expect(preview.targetCompletionDate).toBe(
          preview.slots.at(-1)!.dueDate,
        );
      });
    });

    it('steps over a declared holiday for the sector and names it', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, sector, context, service, terms } =
          await world(tx);
        await tx.holiday.create({
          data: {
            organizationId,
            sectorId: sector.id,
            date: new Date('2026-01-14'),
            name: 'Pongal',
          },
        });
        const preview = await service.preview(context, terms(), SATURDAY);
        expect(preview.slots.map((slot) => slot.dueDate)).not.toContain(
          '2026-01-14',
        );
        expect(preview.holidaysSkipped).toEqual([
          { date: '2026-01-14', name: 'Pongal' },
        ]);
      });
    });

    it('US-031: 10,000 at 150 a day is 67 slots — 66 of 150 and a last of 100', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const preview = await service.preview(
          context,
          terms({ dailyAmount: '150', termDays: 67 }),
          SATURDAY,
        );
        expect(preview.slotCount).toBe(67);
        expect(
          new Set(
            preview.slots.slice(0, 66).map((slot) => slot.expectedAmount),
          ),
        ).toEqual(new Set(['150.00']));
        expect(preview.slots[66]!.expectedAmount).toBe('100.00');
      });
    });
  });

  describe('Scenario: a weekly and a monthly account (BR-04)', () => {
    // Saturday 3 January 2026. N counts instalments at the chosen cadence, so
    // ₹500 × 20 weeks clears ₹10,000 exactly, as ₹100 × 100 days does.
    const weekly = {
      dailyAmount: '500',
      termDays: 20,
      collectionFrequency: 'WEEKLY' as const,
    };

    it('collects a weekly account once a week on the same weekday, starting a week after day 0', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const preview = await service.preview(context, terms(weekly), SATURDAY);

        expect(preview.slotCount).toBe(20);
        expect(preview.firstCollectionDate).toBe('2026-01-10');
        expect(preview.slots.slice(0, 3).map((slot) => slot.dueDate)).toEqual([
          '2026-01-10',
          '2026-01-17',
          '2026-01-24',
        ]);
        expect(
          preview.slots.every(
            (slot) => dayOfWeek(parseCalendarDate(slot.dueDate)) === 6,
          ),
        ).toBe(true);
        expect(sum(preview.slots.map((slot) => slot.expectedAmount))).toBe(
          1_000_000n,
        );
      });
    });

    it('collects a monthly account on the same day of each month', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const preview = await service.preview(
          context,
          terms({
            dailyAmount: '2500',
            termDays: 4,
            collectionFrequency: 'MONTHLY' as const,
          }),
          SATURDAY,
        );
        expect(preview.slots.map((slot) => slot.dueDate)).toEqual([
          '2026-02-03',
          '2026-03-03',
          '2026-04-03',
          '2026-05-04', // Sunday 3 May → Monday 4 May (BR-02)
        ]);
      });
    });

    it('stores the frequency, and the schedule it was generated at', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const account = await service.create(context, terms(weekly), SATURDAY);

        expect(account.collectionFrequency).toBe('WEEKLY');
        expect(account.termDays).toBe(20);
        expect(account.targetCompletionDate).toBe('2026-05-23');
        const slots = await tx.accountSchedule.findMany({
          where: { accountLoanId: account.id },
          orderBy: { sequence: 'asc' },
        });
        expect(slots).toHaveLength(20);
        // Seven calendar days between consecutive visits, with no drift.
        expect(
          slots.every(
            (slot, index) =>
              index === 0 ||
              slot.dueDate.getTime() - slots[index - 1]!.dueDate.getTime() ===
                7 * 86_400_000,
          ),
        ).toBe(true);
      });
    });

    it('defaults to DAILY, so terms entered without a cadence behave as before', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const account = await service.create(context, terms(), SATURDAY);
        expect(account.collectionFrequency).toBe('DAILY');
      });
    });
  });

  describe('creation (US-030)', () => {
    it('stores a PENDING account with its whole schedule, a code, and an audit entry — and posts nothing to the ledger', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, service, terms } = await world(tx);
        const account = await service.create(context, terms(), SATURDAY);

        expect(account).toMatchObject({
          status: 'PENDING',
          accountAmount: '10000.00',
          investedAmount: '8500.00',
          profitAmount: '1500.00',
          outstandingAmount: '10000.00',
          collectedAmount: '0.00',
          disbursementDate: SATURDAY,
          firstCollectionDate: '2026-01-05',
        });
        expect(account.accountCode).toMatch(/^ACC-2026-\d{5,}$/);
        expect(
          await tx.accountSchedule.count({
            where: { accountLoanId: account.id },
          }),
        ).toBe(100);
        expect(
          await tx.ledgerAccount.count({ where: { organizationId } }),
        ).toBe(0);
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: account.id, action: 'CREATE' },
          }),
        ).not.toBeNull();
      });
    });

    it('permits a second concurrent account for the same customer (BR-01a)', async () => {
      await withRollback(prisma, async (tx) => {
        const { customer, context, service, terms } = await world(tx);
        await service.create(context, terms(), SATURDAY);
        await service.create(
          context,
          terms({
            accountAmount: '5000',
            investedAmount: '4200',
            dailyAmount: '50',
          }),
          SATURDAY,
        );
        expect(
          await tx.accountLoan.count({ where: { customerId: customer.id } }),
        ).toBe(2);
      });
    });

    it('refuses a blacklisted customer and an inactive line', async () => {
      await withRollback(prisma, async (tx) => {
        const { customer, line, context, service, terms } = await world(tx);
        await tx.customer.update({
          where: { id: customer.id },
          data: { status: 'BLACKLISTED' },
        });
        await expect(
          service.preview(context, terms(), SATURDAY),
        ).rejects.toMatchObject({
          code: 'CUSTOMER_BLACKLISTED',
        });

        await tx.customer.update({
          where: { id: customer.id },
          data: { status: 'ACTIVE' },
        });
        await tx.line.update({
          where: { id: line.id },
          data: { isActive: false },
        });
        await expect(
          service.preview(context, terms(), SATURDAY),
        ).rejects.toMatchObject({
          code: 'LINE_INACTIVE',
        });
      });
    });
  });

  describe('mid-term accounts (US-030a)', () => {
    const JULY_1 = parseCalendarDate('2026-07-01');
    const ENTERED = parseCalendarDate('2026-08-14');

    async function ledgerOf(
      tx: PrismaClient,
      organizationId: string,
      accountId: string,
    ) {
      const balances = Object.fromEntries(
        (await tx.ledgerAccount.findMany({ where: { organizationId } })).map(
          (account) => [account.accountType, account.balance.toFixed(2)],
        ),
      );
      const transactions = await tx.ledgerTransaction.findMany({
        where: { sourceTable: 'account_loan', sourceId: accountId },
        orderBy: { createdAt: 'asc' },
      });
      return {
        balances,
        transactions: transactions.map((t) => [
          t.transactionType,
          t.businessDate.toISOString().slice(0, 10),
        ]),
      };
    }

    it('Scenario: started 1 July, paid 4,700 of 10,000 — ACTIVE with outstanding 5,300, and the ledger balances', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, fund, service, terms } =
          await world(tx);
        // 8,500 given less 4,700 already back: the net it takes from the office.
        await fund('3800');
        const account = await service.create(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '4700' }),
          ENTERED,
        );

        expect(account).toMatchObject({
          status: 'ACTIVE',
          collectedAmount: '4700.00',
          outstandingAmount: '5300.00',
          disbursementDate: '2026-07-01',
          firstCollectionDate: '2026-07-02',
        });
        const { slots } = await service.schedule(context, account.id);
        expect(
          slots.filter((slot) => slot.status === 'COLLECTED'),
        ).toHaveLength(47);
        const tail = slots.filter((slot) => slot.status === 'PENDING');
        expect(tail[0]).toMatchObject({ sequence: 48, dueDate: '2026-08-15' });
        expect(account.targetCompletionDate).toBe(tail.at(-1)!.dueDate);

        // Disbursement on 1 July; 4,700 caught up on the entry day, earning
        // 15% of it (705.00) — what 47 day-one collections of 100 would have.
        expect(await ledgerOf(tx, organizationId, account.id)).toEqual({
          transactions: [
            ['DISBURSEMENT', '2026-07-01'],
            ['COLLECTION', '2026-08-14'],
          ],
          balances: {
            CAPITAL: '3800.00',
            LOAN_RECEIVABLE: '5300.00',
            CASH_AT_OFFICE: '0.00',
            UNEARNED_PROFIT: '795.00',
            EARNED_PROFIT: '705.00',
          },
        });
      });
    });

    it('Scenario: collected is entered, never inferred — 4,580 paid is outstanding 5,420, with slot 46 partial', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, fund, service, terms } =
          await world(tx);
        await fund('3920');
        const account = await service.create(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '4580' }),
          ENTERED,
        );
        expect(account.outstandingAmount).toBe('5420.00');
        const { slots } = await service.schedule(context, account.id);
        expect(slots.find((slot) => slot.status === 'PARTIAL')?.sequence).toBe(
          46,
        );
        const { balances } = await ledgerOf(tx, organizationId, account.id);
        expect(balances).toMatchObject({
          LOAN_RECEIVABLE: '5420.00',
          EARNED_PROFIT: '687.00',
        });
      });
    });

    it('nothing paid yet: ACTIVE, the disbursement posted and no catch-up', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, fund, service, terms } =
          await world(tx);
        await fund();
        const account = await service.create(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '0' }),
          ENTERED,
        );
        expect(account).toMatchObject({
          status: 'ACTIVE',
          outstandingAmount: '10000.00',
        });
        expect(
          (await ledgerOf(tx, organizationId, account.id)).transactions,
        ).toEqual([['DISBURSEMENT', '2026-07-01']]);
      });
    });

    it('the preview says it is mid-term and how far behind the customer is, saving nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { customer, context, service, terms } = await world(tx);
        const preview = await service.preview(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '4580' }),
          parseCalendarDate('2026-08-25'),
        );
        expect(preview).toMatchObject({
          kind: 'MID_TERM',
          collectedAmount: '4580.00',
          outstandingAmount: '5420.00',
          amountBehind: '120.00',
        });
        expect(
          await tx.accountLoan.count({ where: { customerId: customer.id } }),
        ).toBe(0);
      });
    });

    it('a past date needs collected to date; a present or future date refuses one; a mid-term account is not disbursed again', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, fund, service, terms } = await world(tx);
        await fund('3800');
        await expect(
          service.create(context, terms({ disbursementDate: JULY_1 }), ENTERED),
        ).rejects.toMatchObject({ code: 'COLLECTED_TO_DATE_REQUIRED' });
        await expect(
          service.create(
            context,
            terms({ disbursementDate: ENTERED, collectedToDate: '500' }),
            ENTERED,
          ),
        ).rejects.toMatchObject({ code: 'COLLECTED_TO_DATE_NOT_ALLOWED' });

        const midTerm = await service.create(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '4700' }),
          ENTERED,
        );
        await expect(
          service.disburse(context, midTerm.id, ENTERED),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_PENDING',
        });
      });
    });

    it('worked example: 8,500 given and 300 back before Rasi needs 8,200 in cash-in-hand — 8,199 is refused with nothing saved, and 8,200 leaves the office at exactly 0', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, customer, context, fund, service, terms } =
          await world(tx);
        const midTerm = terms({
          disbursementDate: JULY_1,
          collectedToDate: '300',
        });
        await fund('8199');

        await expect(
          service.create(context, midTerm, ENTERED),
        ).rejects.toMatchObject({
          code: 'INSUFFICIENT_CASH_IN_HAND',
          status: 422,
        });
        expect(
          await tx.accountLoan.count({ where: { customerId: customer.id } }),
        ).toBe(0);

        // One more rupee in, and the same account is entered.
        await fund('1');
        const account = await service.create(context, midTerm, ENTERED);
        expect(account.status).toBe('ACTIVE');
        const { balances } = await ledgerOf(tx, organizationId, account.id);
        expect(balances).toMatchObject({
          CAPITAL: '8200.00',
          CASH_AT_OFFICE: '0.00',
          LOAN_RECEIVABLE: '9700.00',
        });
      });
    });

    it('takes nothing from cash-in-hand once more than the invested amount is back — 9,000 of 10,000 collected needs no capital', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, service, terms } = await world(tx);
        const account = await service.create(
          context,
          terms({ disbursementDate: JULY_1, collectedToDate: '9000' }),
          ENTERED,
        );
        expect(account.outstandingAmount).toBe('1000.00');
        const { balances } = await ledgerOf(tx, organizationId, account.id);
        // −8,500 out, +9,000 back.
        expect(balances.CASH_AT_OFFICE).toBe('500.00');
      });
    });
  });

  describe('correcting terms before disbursement (US-030)', () => {
    it('rebuilds the schedule from the new terms — 10,000 at 100 becomes 12,000 at 150, with a new target date, audited', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        const before = await service.schedule(context, pending.id);

        const corrected = await service.updateTerms(
          context,
          pending.id,
          {
            accountAmount: '12000',
            investedAmount: '10200',
            dailyAmount: '150',
            termDays: 100,
            collectionFrequency: 'DAILY',
            disbursementDate: SATURDAY,
          },
          SATURDAY,
        );

        expect(corrected).toMatchObject({
          status: 'PENDING',
          accountAmount: '12000.00',
          investedAmount: '10200.00',
          // P = A − I, derived and never sent (BR-01).
          profitAmount: '1800.00',
          dailyAmount: '150.00',
          outstandingAmount: '12000.00',
        });

        const after = await service.schedule(context, corrected.id);
        // ceil(12,000 / 150) = 80 slots, where 10,000 at 100 took 100.
        expect(before.slots).toHaveLength(100);
        expect(after.slots).toHaveLength(80);
        expect(sum(after.slots.map((slot) => slot.expectedAmount))).toBe(
          1_200_000n,
        );
        expect(corrected.targetCompletionDate).toBe(
          after.slots.at(-1)!.dueDate,
        );
        // The code never changes: it is the same account, corrected.
        expect(corrected.accountCode).toBe(pending.accountCode);

        expect(
          await tx.auditLog.findFirst({
            where: { entityId: pending.id, action: 'UPDATE' },
          }),
        ).not.toBeNull();
      });
    });

    it('refuses once the account is disbursed — the amounts are fixed from then on', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, owner, fund, service, terms } = await world(tx);
        await fund();
        const account = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );

        await expect(
          service.updateTerms(
            context,
            account.id,
            {
              accountAmount: '12000',
              investedAmount: '10200',
              dailyAmount: '150',
              termDays: 100,
              collectionFrequency: 'DAILY',
              disbursementDate: SATURDAY,
            },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_PENDING' });
      });
    });

    it('refuses to move a pending account into the past, which is how a mid-term account is entered', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);

        await expect(
          service.updateTerms(
            context,
            pending.id,
            {
              accountAmount: '10000',
              investedAmount: '8500',
              dailyAmount: '100',
              termDays: 100,
              collectionFrequency: 'DAILY',
              disbursementDate: '2026-01-02',
            },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'DISBURSEMENT_DATE_IN_PAST' });
      });
    });

    it('another organization’s account is not found', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const elsewhere = await world(tx);
        const theirs = await elsewhere.service.create(
          elsewhere.context,
          elsewhere.terms(),
          SATURDAY,
        );

        await expect(
          service.updateTerms(
            context,
            theirs.id,
            {
              accountAmount: '10000',
              investedAmount: '8500',
              dailyAmount: '100',
              termDays: 100,
              collectionFrequency: 'DAILY',
              disbursementDate: SATURDAY,
            },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
        expect(terms).toBeDefined();
      });
    });
  });

  describe('disbursement (US-032, BR-18)', () => {
    it('activates the account and posts receivable 10,000 against office cash 8,500 and unearned profit 1,500, balanced', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, owner, fund, service, terms } =
          await world(tx);
        // The Admin creates it; the owner puts in 8,500 and pays it out.
        const pending = await service.create(context, terms(), SATURDAY);
        await fund('8500');
        const active = await service.disburse(owner, pending.id, SATURDAY);
        expect(active.status).toBe('ACTIVE');

        const transaction = await tx.ledgerTransaction.findFirstOrThrow({
          where: { sourceTable: 'account_loan', sourceId: pending.id },
          include: {
            entries: {
              include: { ledgerAccount: true },
              orderBy: { sequence: 'asc' },
            },
          },
        });
        expect(transaction.transactionType).toBe('DISBURSEMENT');
        expect(transaction.businessDate.toISOString().slice(0, 10)).toBe(
          SATURDAY,
        );
        expect(
          transaction.entries.map((entry) => [
            entry.ledgerAccount.accountType,
            entry.direction,
            entry.amount.toFixed(2),
          ]),
        ).toEqual([
          ['LOAN_RECEIVABLE', 'DEBIT', '10000.00'],
          ['CASH_AT_OFFICE', 'CREDIT', '8500.00'],
          ['UNEARNED_PROFIT', 'CREDIT', '1500.00'],
        ]);

        const balances = Object.fromEntries(
          (await tx.ledgerAccount.findMany({ where: { organizationId } })).map(
            (account) => [account.accountType, account.balance.toFixed(2)],
          ),
        );
        expect(balances).toEqual({
          LOAN_RECEIVABLE: '10000.00',
          // The owner's 8,500 went straight out as the loan.
          CAPITAL: '8500.00',
          CASH_AT_OFFICE: '0.00',
          UNEARNED_PROFIT: '1500.00',
        });
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: pending.id, action: 'UPDATE' },
          }),
        ).not.toBeNull();
      });
    });

    it('"Save and disburse" does both in one call', async () => {
      await withRollback(prisma, async (tx) => {
        const { owner, fund, service, terms } = await world(tx);
        await fund();
        const account = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );
        expect(account.status).toBe('ACTIVE');
        expect(
          await tx.ledgerTransaction.count({
            where: { sourceId: account.id, transactionType: 'DISBURSEMENT' },
          }),
        ).toBe(1);
      });
    });

    it('a second account reuses the organization’s office and profit accounts; another organization gets its own', async () => {
      await withRollback(prisma, async (tx) => {
        const first = await world(tx);
        await first.fund('17000');
        await first.service.create(
          first.owner,
          first.terms({ disburse: true }),
          SATURDAY,
        );
        await first.service.create(
          first.owner,
          first.terms({ disburse: true }),
          SATURDAY,
        );
        const second = await world(tx);
        await second.fund();
        await second.service.create(
          second.owner,
          second.terms({ disburse: true }),
          SATURDAY,
        );

        const singletons = (organizationId: string) =>
          tx.ledgerAccount.count({
            where: {
              organizationId,
              accountType: { in: ['CASH_AT_OFFICE', 'UNEARNED_PROFIT'] },
            },
          });
        expect(await singletons(first.organizationId)).toBe(2);
        expect(await singletons(second.organizationId)).toBe(2);
        const office = await tx.ledgerAccount.findFirstOrThrow({
          where: {
            organizationId: first.organizationId,
            accountType: 'CASH_AT_OFFICE',
          },
        });
        // 17,000 put in, two loans of 8,500 paid out of it.
        expect(office.balance.toFixed(2)).toBe('0.00');
      });
    });

    it('refuses an account that is not pending, and one planned for a later day', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, owner, fund, service, terms } = await world(tx);
        await fund();
        const active = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );
        await expect(
          service.disburse(owner, active.id, SATURDAY),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_PENDING',
        });

        const later = await service.create(
          context,
          terms({ disbursementDate: '2026-01-10' }),
          SATURDAY,
        );
        await expect(
          service.disburse(owner, later.id, SATURDAY),
        ).rejects.toMatchObject({
          code: 'DISBURSEMENT_DATE_IN_FUTURE',
        });
      });
    });

    it('a pending account disbursed after its planned day is re-dated to today, with its schedule regenerated', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, owner, fund, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        await fund();
        // Disbursed on Wednesday 7 January instead.
        const active = await service.disburse(
          owner,
          pending.id,
          parseCalendarDate('2026-01-07'),
        );

        expect(active).toMatchObject({
          disbursementDate: '2026-01-07',
          firstCollectionDate: '2026-01-08',
        });
        const slots = await service.schedule(context, pending.id);
        expect(slots.slots).toHaveLength(100);
        expect(slots.slots[0]!.dueDate).toBe('2026-01-08');
        const posted = await tx.ledgerTransaction.findFirstOrThrow({
          where: { sourceId: pending.id },
        });
        expect(posted.businessDate.toISOString().slice(0, 10)).toBe(
          '2026-01-07',
        );
      });
    });

    it('refuses a loan the office cannot pay out — ₹8,499 in cash-in-hand against ₹8,500 invested — and posts nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, owner, fund, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        await fund('8499');

        await expect(
          service.disburse(owner, pending.id, SATURDAY),
        ).rejects.toMatchObject({
          code: 'INSUFFICIENT_CASH_IN_HAND',
          status: 422,
        });
        expect(
          await tx.ledgerTransaction.count({
            where: { sourceId: pending.id, transactionType: 'DISBURSEMENT' },
          }),
        ).toBe(0);

        // One more rupee in, and the same loan goes out.
        await fund('1');
        const active = await service.disburse(owner, pending.id, SATURDAY);
        expect(active.status).toBe('ACTIVE');
      });
    });

    it('"Save and disburse" by an Admin is refused: only the Super Admin pays money out', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, fund, service, terms } = await world(tx);
        await fund();

        await expect(
          service.create(context, terms({ disburse: true }), SATURDAY),
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      });
    });
  });

  describe('a Senior’s account waits for approval (decided 2026-10-03)', () => {
    /** The line's Senior, as the request context resolver would give them. */
    const seniorOf = async (
      tx: PrismaClient,
      w: Awaited<ReturnType<typeof world>>,
    ): Promise<RequestContext> => {
      const senior = await createStaff(tx, w.organizationId, 'SENIOR');
      return {
        ...w.context,
        userId: senior.userId,
        staffProfileId: senior.id,
        role: 'SENIOR',
        currentLineIds: [w.line.id],
      };
    };

    it('a Senior’s account is PENDING and not approved, audited as waiting; an Admin’s is approved as it is created', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const senior = await seniorOf(tx, w);
        // The world's own Admin is stored as a Senior; this one is an Admin
        // in the database, so it is one of the notice's recipients.
        const officeAdmin = await createStaff(tx, w.organizationId, 'ADMIN');

        const theirs = await w.service.create(senior, w.terms(), SATURDAY);
        const admins = await w.service.create(w.context, w.terms(), SATURDAY);

        // Every Admin hears of the Senior's account, and of no Admin's own.
        const told = await tx.notification.findMany({
          where: { userId: officeAdmin.userId },
          select: { eventType: true },
        });
        expect(told.map((n) => n.eventType)).toEqual([
          'ACCOUNT_APPROVAL_REQUESTED',
        ]);

        expect(theirs).toMatchObject({ status: 'PENDING', approvedAt: null });
        expect(admins.status).toBe('PENDING');
        expect(admins.approvedAt).not.toBeNull();
        expect(
          await tx.auditLog.findFirst({ where: { entityId: theirs.id } }),
        ).toMatchObject({
          action: 'CREATE',
          actorUserId: senior.userId,
          after: expect.objectContaining({ awaitingApproval: true }),
        });
      });
    });

    it('an Admin approves it once, audited; the Super Admin may then disburse it', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const senior = await seniorOf(tx, w);
        const account = await w.service.create(senior, w.terms(), SATURDAY);

        const approved = await w.service.approve(w.context, account.id);
        expect(approved.approvedAt).not.toBeNull();
        // The Senior who opened it hears it was approved.
        expect(
          await tx.notification.findMany({
            where: { userId: senior.userId, eventType: 'ACCOUNT_APPROVED' },
            select: { body: true },
          }),
        ).toEqual([{ body: expect.stringContaining('approved Lakshmi') }]);
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: account.id, action: 'APPROVE' },
          }),
        ).toMatchObject({
          entityTable: 'account_loan',
          actorUserId: w.context.userId,
        });
        await expect(
          w.service.approve(w.context, account.id),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_ALREADY_APPROVED',
          status: 409,
        });

        await w.fund();
        const disbursed = await w.service.disburse(
          w.owner,
          account.id,
          SATURDAY,
        );
        expect(disbursed.status).toBe('ACTIVE');
        expect(disbursed.approvedAt).toBe(approved.approvedAt);
        await expect(
          w.service.approve(w.context, account.id),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_PENDING', status: 422 });
      });
    });

    it('the Super Admin disbursing one still waiting approves it in the same step', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const senior = await seniorOf(tx, w);
        const account = await w.service.create(senior, w.terms(), SATURDAY);
        await w.fund();

        const disbursed = await w.service.disburse(
          w.owner,
          account.id,
          SATURDAY,
        );

        expect(disbursed.status).toBe('ACTIVE');
        expect(disbursed.approvedAt).not.toBeNull();
        expect(
          await tx.accountLoan.findUniqueOrThrow({ where: { id: account.id } }),
        ).toMatchObject({ approvedByUserId: w.owner.userId });
      });
    });

    it('a Senior cannot enter a mid-term account, nor open one for a customer off their lines, nor disburse', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const senior = await seniorOf(tx, w);
        const today = parseCalendarDate('2026-01-10');

        await expect(
          w.service.create(senior, w.terms({ collectedToDate: '0' }), today),
        ).rejects.toMatchObject({ code: 'MID_TERM_NEEDS_ADMIN', status: 403 });
        await expect(
          w.service.create(
            { ...senior, currentLineIds: [] },
            w.terms(),
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND', status: 404 });
        // Both refusals above come before any write.
        expect(
          await tx.accountLoan.count({ where: { customerId: w.customer.id } }),
        ).toBe(0);
        await expect(
          w.service.create(senior, w.terms({ disburse: true }), SATURDAY),
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      });
    });
  });

  describe('money visibility (RBAC matrix)', () => {
    it('a Junior on the line sees the account without invested amount or profit', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, line, context, service, terms } =
          await world(tx);
        const account = await service.create(context, terms(), SATURDAY);
        const junior = await createStaff(tx, organizationId, 'JUNIOR');
        const juniorContext: RequestContext = {
          ...context,
          userId: junior.userId,
          staffProfileId: junior.id,
          role: 'JUNIOR',
          currentLineIds: [line.id],
        };
        const seen = await service.get(juniorContext, account.id);
        expect(seen).toMatchObject({
          accountAmount: '10000.00',
          investedAmount: null,
          profitAmount: null,
        });
        const senior = await service.get(
          { ...juniorContext, role: 'SENIOR' },
          account.id,
        );
        expect(senior.profitAmount).toBe('1500.00');
      });
    });
  });

  /**
   * US-035 — closing an account by hand. Only WRITTEN_OFF posts (decided
   * 2026-09-20): DEFAULTED stops collection and leaves the money owed.
   */
  describe('closing an account (US-035)', () => {
    const balancesOf = async (tx: PrismaClient, organizationId: string) =>
      Object.fromEntries(
        (await tx.ledgerAccount.findMany({ where: { organizationId } })).map(
          (account) => [account.accountType, account.balance.toFixed(2)],
        ),
      );

    it('Scenario: written off before a rupee arrives — the receivable and its unearned profit clear, and the 8,500 put out is the loss', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, owner, fund, service, terms } =
          await world(tx);
        await fund();
        const account = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );

        const closed = await service.close(
          context,
          account.id,
          { status: 'WRITTEN_OFF', note: 'Left the area; not traceable' },
          SATURDAY,
        );

        expect(closed.status).toBe('WRITTEN_OFF');
        expect(await balancesOf(tx, organizationId)).toEqual({
          // Nothing is owed and no profit is expected any more; what the
          // business paid out and did not get back is the loss.
          LOAN_RECEIVABLE: '0.00',
          CAPITAL: '8500.00',
          CASH_AT_OFFICE: '0.00',
          UNEARNED_PROFIT: '0.00',
          WRITE_OFF_LOSS: '8500.00',
        });

        const writeOff = await tx.ledgerTransaction.findFirstOrThrow({
          where: { sourceId: account.id, transactionType: 'WRITE_OFF' },
          include: { entries: { include: { ledgerAccount: true } } },
        });
        expect(
          writeOff.entries.map((entry) => [
            entry.ledgerAccount.accountType,
            entry.direction,
            entry.amount.toFixed(2),
          ]),
        ).toEqual([
          ['LOAN_RECEIVABLE', 'CREDIT', '10000.00'],
          ['UNEARNED_PROFIT', 'DEBIT', '1500.00'],
          ['WRITE_OFF_LOSS', 'DEBIT', '8500.00'],
        ]);

        // Nothing is expected any more, and the closure is on the record.
        expect(
          await tx.accountSchedule.count({
            where: { accountLoanId: account.id, status: 'PENDING' },
          }),
        ).toBe(0);
        const row = await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
        });
        expect(row.closureNote).toBe('Left the area; not traceable');
        expect(row.isOverdue).toBe(false);
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: account.id, action: 'UPDATE' },
          }),
        ).not.toBeNull();
      });
    });

    it('defaulting stops collection but posts nothing — the money is still owed', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, owner, fund, service, terms } =
          await world(tx);
        await fund();
        const account = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );

        const closed = await service.close(
          context,
          account.id,
          { status: 'DEFAULTED', note: 'Refusing to pay; with the Senior' },
          SATURDAY,
        );

        expect(closed.status).toBe('DEFAULTED');
        expect(await balancesOf(tx, organizationId)).toEqual({
          // Exactly the disbursement, untouched: the receivable stands.
          LOAN_RECEIVABLE: '10000.00',
          CAPITAL: '8500.00',
          CASH_AT_OFFICE: '0.00',
          UNEARNED_PROFIT: '1500.00',
        });
        expect(
          await tx.ledgerTransaction.count({
            where: { sourceId: account.id, transactionType: 'WRITE_OFF' },
          }),
        ).toBe(0);
        expect(
          await tx.accountSchedule.count({
            where: { accountLoanId: account.id, status: 'PENDING' },
          }),
        ).toBe(0);
      });
    });

    it('a pending account cannot be closed, and neither can one that is already closed', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, owner, fund, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        await expect(
          service.close(
            context,
            pending.id,
            { status: 'DEFAULTED', note: 'Never disbursed' },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });

        await fund();
        const active = await service.create(
          owner,
          terms({ disburse: true }),
          SATURDAY,
        );
        await service.close(
          context,
          active.id,
          { status: 'WRITTEN_OFF', note: 'Gone' },
          SATURDAY,
        );
        await expect(
          service.close(
            context,
            active.id,
            { status: 'DEFAULTED', note: 'Again' },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
      });
    });
  });
});
