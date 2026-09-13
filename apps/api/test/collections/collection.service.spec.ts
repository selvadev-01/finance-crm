import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { RouteService } from '../../src/collections/route.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * Recording collections (M07, US-041, US-053) and completion (US-033) against
 * real rows, rolled back. Collections and ledger rows reject DELETE, so this
 * is the only tier that writes them; the deferred balancing trigger fires
 * before the rollback.
 */
describe('CollectionService (US-041, US-053, US-033)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const SATURDAY = parseCalendarDate('2026-01-03');
  /** 10:00 IST on a business date, as the device would send it. */
  const at = (date: string, time = '10:00:00') => `${date}T${time}+05:30`;
  const serverNow = (date: string) => new Date(`${date}T10:00:05+05:30`);

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const organizationId = organization.id;
    const admin = await createStaff(tx, organizationId, 'SENIOR');
    const junior = await createStaff(tx, organizationId, 'JUNIOR');
    const adminContext: RequestContext = {
      requestId: 'req_test',
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId,
      role: 'ADMIN',
      currentLineId: null,
    };
    const juniorContext: RequestContext = {
      ...adminContext,
      userId: junior.userId,
      staffProfileId: junior.id,
      role: 'JUNIOR',
      currentLineId: line.id,
    };
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const accounts = new AccountService(database, audit, ledger);
    const warnings: string[] = [];
    const logger = {
      warn: (_: object, message: string) => warnings.push(message),
    } as unknown as PinoLogger;
    const collections = new CollectionService(database, audit, ledger, logger);
    const routes = new RouteService(database);

    const customer = async (name = 'Lakshmi') =>
      tx.customer.create({
        data: {
          organizationId,
          customerCode: `C-${randomUUID()}`,
          name,
          mobile: '+919800000001',
          address: '12 Market Road',
          sectorId: sector.id,
          lineId: line.id,
        },
      });

    /** A disbursed account, day one on Saturday 3 January. */
    const account = async (
      terms: {
        accountAmount?: string;
        investedAmount?: string;
        dailyAmount?: string;
      } = {},
      customerId?: string,
    ) =>
      accounts.create(
        adminContext,
        {
          customerId: customerId ?? (await customer()).id,
          accountAmount: terms.accountAmount ?? '10000',
          investedAmount: terms.investedAmount ?? '8500',
          dailyAmount: terms.dailyAmount ?? '100',
          termDays: 100,
          disbursementDate: SATURDAY,
          disburse: true,
        },
        SATURDAY,
      );

    const collect = (
      accountLoanId: string,
      amount: string,
      date = '2026-01-05',
      key: string = randomUUID(),
    ) =>
      collections.record(
        juniorContext,
        {
          idempotencyKey: key,
          accountLoanId,
          amount,
          capturedAt: at(date),
          note: undefined,
        },
        serverNow(date),
      );

    const balances = async () =>
      Object.fromEntries(
        (
          await tx.ledgerAccount.findMany({
            where: { organizationId, accountLoanId: null },
          })
        ).map((row) => [row.accountType, row.balance.toFixed(2)]),
      );

    return {
      organizationId,
      sector,
      line,
      adminContext,
      juniorContext,
      customer,
      account,
      collect,
      collections,
      routes,
      balances,
      warnings,
      accounts,
    };
  }

  describe('US-041', () => {
    it('Scenario: exact amount — CORRECT, outstanding down by 100, slot 1 collected, cash and earned profit posted', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { replayed, collection } = await w.collect(account.id, '100');

        expect(replayed).toBe(false);
        expect(collection).toMatchObject({
          businessDate: '2026-01-05',
          expectedAmount: '100.00',
          amount: '100.00',
          variance: '0.00',
          classification: 'CORRECT',
          lineId: w.line.id,
          collectedByUserId: w.juniorContext.userId,
          account: {
            status: 'ACTIVE',
            collectedAmount: '100.00',
            outstandingAmount: '9900.00',
          },
        });
        const slot = await tx.accountSchedule.findUniqueOrThrow({
          where: { id: collection.accountScheduleId! },
        });
        expect(slot).toMatchObject({ sequence: 1, status: 'COLLECTED' });
        expect(await w.balances()).toMatchObject({
          CASH_IN_HAND: '100.00',
          CASH_AT_OFFICE: '-8500.00',
          UNEARNED_PROFIT: '1485.00',
          EARNED_PROFIT: '15.00',
        });
        expect(
          await tx.auditLog.findFirst({ where: { entityId: collection.id } }),
        ).not.toBeNull();
      });
    });

    it('Scenario: low collection — 80 against 100 is LOW −20 and the target completion date moves out', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { collection } = await w.collect(account.id, '80');
        expect(collection).toMatchObject({
          classification: 'LOW',
          variance: '-20.00',
        });
        expect(collection.account.outstandingAmount).toBe('9920.00');
        // 9,920 needs ceil(99.2) = 100 more slots after 5 January: one day later than planned.
        expect(
          collection.account.targetCompletionDate >
            account.targetCompletionDate,
        ).toBe(true);
        const pending = await tx.accountSchedule.count({
          where: { accountLoanId: account.id, status: 'PENDING' },
        });
        expect(pending).toBe(100);
      });
    });

    it('Scenario: extra collection — 120 is EXTRA +20 and the outstanding reduces by 120', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { collection } = await w.collect(account.id, '120');
        expect(collection).toMatchObject({
          classification: 'EXTRA',
          variance: '20.00',
          account: { outstandingAmount: '9880.00' },
        });
      });
    });

    it('Scenario: customer paid nothing — NO_PAYMENT, a visit on record, no ledger posting, the balance unchanged', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { collection } = await w.collect(account.id, '0');
        expect(collection).toMatchObject({
          classification: 'NO_PAYMENT',
          variance: '-100.00',
        });
        expect(collection.account.outstandingAmount).toBe('10000.00');
        expect(
          await tx.collection.count({ where: { accountLoanId: account.id } }),
        ).toBe(1);
        expect(
          await tx.ledgerTransaction.count({
            where: { sourceTable: 'collection' },
          }),
        ).toBe(0);
        const slot = await tx.accountSchedule.findUniqueOrThrow({
          where: { id: collection.accountScheduleId! },
        });
        expect(slot.status).toBe('PARTIAL');
      });
    });

    it('Scenario: cannot exceed outstanding — the reason states the outstanding', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account({
          accountAmount: '180',
          investedAmount: '150',
          dailyAmount: '100',
        });
        await w.collect(account.id, '100');
        await expect(
          w.collect(account.id, '200', '2026-01-06'),
        ).rejects.toMatchObject({
          code: 'AMOUNT_EXCEEDS_OUTSTANDING',
          message: expect.stringContaining('₹80.00'),
        });
      });
    });

    it('freezes the line at write: a customer moved later does not move the collection', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { collection } = await w.collect(account.id, '100');
        const other = await tx.line.create({
          data: {
            organizationId: w.organizationId,
            sectorId: w.sector.id,
            code: `L-${randomUUID()}`,
            name: 'Line 7',
          },
        });
        await tx.customer.update({
          where: { id: account.customerId },
          data: { lineId: other.id },
        });
        const stored = await tx.collection.findUniqueOrThrow({
          where: { id: collection.id },
        });
        expect(stored.lineId).toBe(w.line.id);
      });
    });

    it('answers the earliest pending slot due on or before the business date; a pending or completed account is refused', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        // Nothing collected on Monday 5th; Tuesday's collection answers slot 1.
        const { collection } = await w.collect(account.id, '100', '2026-01-06');
        const slot = await tx.accountSchedule.findUniqueOrThrow({
          where: { id: collection.accountScheduleId! },
        });
        expect(slot.sequence).toBe(1);

        const pending = await w.accounts.create(
          w.adminContext,
          {
            customerId: (await w.customer()).id,
            accountAmount: '1000',
            investedAmount: '900',
            dailyAmount: '100',
            termDays: 10,
            disbursementDate: SATURDAY,
            disburse: false,
          },
          SATURDAY,
        );
        await expect(w.collect(pending.id, '100')).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_ACTIVE',
        });
      });
    });

    it('a Junior cannot record against an account off their line (404, as for a missing one)', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const elsewhere = await tx.line.create({
          data: {
            organizationId: w.organizationId,
            sectorId: w.sector.id,
            code: `L-${randomUUID()}`,
            name: 'Line 9',
          },
        });
        await expect(
          w.collections.record(
            { ...w.juniorContext, currentLineId: elsewhere.id },
            {
              idempotencyKey: randomUUID(),
              accountLoanId: account.id,
              amount: '100',
              capturedAt: at('2026-01-05'),
              note: undefined,
            },
            serverNow('2026-01-05'),
          ),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      });
    });

    it('a device clock far ahead is not believed: the business date comes from the server, and it is logged', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const { collection } = await w.collections.record(
          w.juniorContext,
          {
            idempotencyKey: randomUUID(),
            accountLoanId: account.id,
            amount: '100',
            capturedAt: at('2026-01-09'),
            note: undefined,
          },
          serverNow('2026-01-05'),
        );
        expect(collection.businessDate).toBe('2026-01-05');
        expect(collection.capturedAt).toBe('2026-01-09T04:30:00.000Z');
        expect(w.warnings).toHaveLength(1);
      });
    });
  });

  describe('US-053 replay creates no duplicates', () => {
    it('Scenario: ambiguous outcome — the same key returns the original result, one collection, the balance reduced once', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const key = randomUUID();
        const first = await w.collect(account.id, '100', '2026-01-05', key);
        const retry = await w.collect(account.id, '100', '2026-01-05', key);

        expect(retry).toEqual({ replayed: true, collection: first.collection });
        expect(
          await tx.collection.count({ where: { accountLoanId: account.id } }),
        ).toBe(1);
        const stored = await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
        });
        expect(stored.outstandingAmount.toFixed(2)).toBe('9900.00');
        expect(
          await tx.ledgerTransaction.count({
            where: { sourceTable: 'collection' },
          }),
        ).toBe(1);
      });
    });

    it('the same key with a different collection is 409 — a client bug, not a replay', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account();
        const key = randomUUID();
        await w.collect(account.id, '100', '2026-01-05', key);
        await expect(
          w.collect(account.id, '90', '2026-01-05', key),
        ).rejects.toMatchObject({
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      });
    });
  });

  describe('US-033 completion on balance', () => {
    it('Scenario: overpayment finishes early — outstanding 80 expects 80, and collecting 80 completes with variance 0', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account({
          accountAmount: '180',
          investedAmount: '153',
          dailyAmount: '100',
        });
        await w.collect(account.id, '100');

        const route = await w.routes.route(
          w.juniorContext,
          parseCalendarDate('2026-01-06'),
        );
        expect(route.customers[0]!.accounts[0]).toMatchObject({
          expectedAmount: '80.00',
          outstandingAmount: '80.00',
        });

        const { collection } = await w.collect(account.id, '80', '2026-01-06');
        expect(collection).toMatchObject({
          expectedAmount: '80.00',
          variance: '0.00',
          classification: 'CORRECT',
          account: {
            status: 'COMPLETED',
            outstandingAmount: '0.00',
            actualCompletionDate: '2026-01-06',
          },
        });
        // All of P earned, nothing left unearned (BR-18 running total).
        expect(await w.balances()).toMatchObject({
          UNEARNED_PROFIT: '0.00',
          EARNED_PROFIT: '27.00',
        });
      });
    });

    it('paying the rest early cancels the remaining slots', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const account = await w.account({
          accountAmount: '300',
          investedAmount: '255',
          dailyAmount: '100',
        });
        await w.collect(account.id, '100');
        const { collection } = await w.collect(account.id, '200', '2026-01-06');
        expect(collection.account.status).toBe('COMPLETED');
        const statuses = (
          await tx.accountSchedule.findMany({
            where: { accountLoanId: account.id },
          })
        ).map((s) => s.status);
        expect(statuses).not.toContain('PENDING');
        await expect(
          w.collect(account.id, '0', '2026-01-07'),
        ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
      });
    });
  });

  describe('US-040 route', () => {
    it('lists accounts due today grouped by customer, with expected and outstanding and what was collected today', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const both = await w.customer('Two accounts');
        const first = await w.account({}, both.id);
        await w.account(
          {
            accountAmount: '15000',
            investedAmount: '12750',
            dailyAmount: '150',
          },
          both.id,
        );
        await w.collect(first.id, '100');

        const route = await w.routes.route(
          w.juniorContext,
          parseCalendarDate('2026-01-05'),
        );
        expect(route.day).toEqual({ kind: 'WORKING' });
        const group = route.customers.find((c) => c.customerId === both.id)!;
        expect(group.accounts.map((a) => a.expectedAmount).sort()).toEqual([
          '100.00',
          '150.00',
        ]);
        expect(
          group.accounts.find((a) => a.accountLoanId === first.id)!
            .collectedToday,
        ).toEqual({
          amount: '100.00',
          classification: 'CORRECT',
        });
        expect(JSON.stringify(route)).not.toMatch(/invested|profit/i);
      });
    });

    it('Scenario: Sunday — empty, and says so; a declared holiday names itself', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        await w.account();
        const sunday = await w.routes.route(
          w.juniorContext,
          parseCalendarDate('2026-01-04'),
        );
        expect(sunday).toMatchObject({
          day: { kind: 'SUNDAY' },
          customers: [],
        });

        await tx.holiday.create({
          data: {
            organizationId: w.organizationId,
            sectorId: null,
            date: new Date('2026-01-14'),
            name: 'Pongal',
          },
        });
        const holiday = await w.routes.route(
          w.juniorContext,
          parseCalendarDate('2026-01-14'),
        );
        expect(holiday).toMatchObject({
          day: { kind: 'HOLIDAY', name: 'Pongal' },
          customers: [],
        });
      });
    });
  });
});
