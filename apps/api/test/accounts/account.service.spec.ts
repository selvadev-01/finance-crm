import type { PrismaClient } from '@repo/db';
import { openLinePeriod } from '../database.js';
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
      currentLineId: null,
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
    );
    const terms = (overrides: object = {}) => ({
      customerId: customer.id,
      accountAmount: '10000',
      investedAmount: '8500',
      dailyAmount: '100',
      termDays: 100,
      disbursementDate: SATURDAY,
      disburse: false,
      ...overrides,
    });
    return { organizationId, sector, line, context, customer, service, terms };
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
        const { organizationId, context, service, terms } = await world(tx);
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
            LOAN_RECEIVABLE: '5300.00',
            CASH_AT_OFFICE: '-3800.00',
            UNEARNED_PROFIT: '795.00',
            EARNED_PROFIT: '705.00',
          },
        });
      });
    });

    it('Scenario: collected is entered, never inferred — 4,580 paid is outstanding 5,420, with slot 46 partial', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, service, terms } = await world(tx);
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
        const { organizationId, context, service, terms } = await world(tx);
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
        const { context, service, terms } = await world(tx);
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
  });

  describe('disbursement (US-032, BR-18)', () => {
    it('activates the account and posts receivable 10,000 against office cash 8,500 and unearned profit 1,500, balanced', async () => {
      await withRollback(prisma, async (tx) => {
        const { organizationId, context, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        const active = await service.disburse(context, pending.id, SATURDAY);
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
          CASH_AT_OFFICE: '-8500.00',
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
        const { context, service, terms } = await world(tx);
        const account = await service.create(
          context,
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
        await first.service.create(
          first.context,
          first.terms({ disburse: true }),
          SATURDAY,
        );
        await first.service.create(
          first.context,
          first.terms({ disburse: true }),
          SATURDAY,
        );
        const second = await world(tx);
        await second.service.create(
          second.context,
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
        expect(office.balance.toFixed(2)).toBe('-17000.00');
      });
    });

    it('refuses an account that is not pending, and one planned for a later day', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const active = await service.create(
          context,
          terms({ disburse: true }),
          SATURDAY,
        );
        await expect(
          service.disburse(context, active.id, SATURDAY),
        ).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_PENDING',
        });

        const later = await service.create(
          context,
          terms({ disbursementDate: '2026-01-10' }),
          SATURDAY,
        );
        await expect(
          service.disburse(context, later.id, SATURDAY),
        ).rejects.toMatchObject({
          code: 'DISBURSEMENT_DATE_IN_FUTURE',
        });
      });
    });

    it('a pending account disbursed after its planned day is re-dated to today, with its schedule regenerated', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        // Disbursed on Wednesday 7 January instead.
        const active = await service.disburse(
          context,
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
          currentLineId: line.id,
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
        const { organizationId, context, service, terms } = await world(tx);
        const account = await service.create(
          context,
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
          CASH_AT_OFFICE: '-8500.00',
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
        const { organizationId, context, service, terms } = await world(tx);
        const account = await service.create(
          context,
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
          CASH_AT_OFFICE: '-8500.00',
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
        const { context, service, terms } = await world(tx);
        const pending = await service.create(context, terms(), SATURDAY);
        await expect(
          service.close(
            context,
            pending.id,
            { status: 'DEFAULTED', note: 'Never disbursed' },
            SATURDAY,
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });

        const active = await service.create(
          context,
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
