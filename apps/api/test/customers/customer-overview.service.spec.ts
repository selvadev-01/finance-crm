import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CustomerOverviewService } from '../../src/customers/customer-overview.service.js';
import { LinePortfolioService } from '../../src/customers/line-portfolio.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient, openLinePeriod } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * Customer 360's figures (US-022, M04). Accounts are disbursed here, which
 * writes the ledger, so this is Tier 1 and every case rolls back.
 */
describe('CustomerOverviewService (US-022)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const SATURDAY = parseCalendarDate('2026-01-03');

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const organizationId = organization.id;
    const admin = await createStaff(tx, organizationId, 'ADMIN');
    const context: RequestContext = {
      requestId: 'req_test',
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId,
      role: 'ADMIN',
      currentLineId: null,
    };
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const accounts = new AccountService(
      database,
      audit,
      new LedgerService(database),
    );
    const overview = new CustomerOverviewService(database);

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
          linePeriods: openLinePeriod(line.id),
        },
      });

    /** A disbursed account of `amount`, daily 100 over its own term. */
    const account = async (customerId: string, amount: string) =>
      accounts.create(
        context,
        {
          customerId,
          accountAmount: amount,
          investedAmount: (Number(amount) * 0.85).toFixed(2),
          dailyAmount: '100',
          termDays: Number(amount) / 100,
          collectionFrequency: 'DAILY',
          disbursementDate: SATURDAY,
          disburse: true,
        },
        SATURDAY,
      );

    return { organizationId, line, context, overview, customer, account, tx };
  }

  it('Scenario: two active accounts — 4,000 and 7,500 outstanding, totalling 11,500 across accounts', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const person = await w.customer();
      await w.account(person.id, '4000');
      await w.account(person.id, '7500');

      const view = await w.overview.get(w.context, person.id, SATURDAY);

      expect(view).toMatchObject({
        accounts: { active: 2, completed: 0, other: 0 },
        // Nothing collected yet, so each account still owes its full amount.
        outstandingTotal: '11500.00',
        collectedTotal: '0.00',
      });
    });
  });

  it('counts completed and pending accounts apart from active ones, and leaves completed out of outstanding', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const person = await w.customer();
      const active = await w.account(person.id, '4000');
      const done = await w.account(person.id, '1000');
      // Paid off: it keeps its collected total but owes nothing.
      await w.tx.accountLoan.update({
        where: { id: done.id },
        data: {
          status: 'COMPLETED',
          outstandingAmount: '0.00',
          collectedAmount: '1000.00',
          actualCompletionDate: new Date('2026-02-02'),
        },
      });

      const view = await w.overview.get(w.context, person.id, SATURDAY);

      expect(view.accounts).toEqual({ active: 1, completed: 1, other: 0 });
      expect(view.outstandingTotal).toBe('4000.00');
      // Collected counts every account the customer has ever held.
      expect(view.collectedTotal).toBe('1000.00');
      expect(active.status).toBe('ACTIVE');
    });
  });

  it('names the Senior and Juniors working the line today, and no one once their assignment has ended', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const person = await w.customer();
      const senior = await createStaff(tx, w.organizationId, 'SENIOR');
      const junior = await createStaff(tx, w.organizationId, 'JUNIOR');
      await tx.lineAssignment.createMany({
        data: [
          {
            staffProfileId: senior.id,
            lineId: w.line.id,
            assignmentRole: 'SENIOR',
            effectiveFrom: new Date('2026-01-01'),
          },
          {
            staffProfileId: junior.id,
            lineId: w.line.id,
            assignmentRole: 'JUNIOR',
            effectiveFrom: new Date('2026-01-01'),
            // Left the line before the date asked about.
            effectiveTo: new Date('2026-01-02'),
          },
        ],
      });

      const view = await w.overview.get(w.context, person.id, SATURDAY);

      // Every fixture user carries the same name; what matters is the role.
      expect(view.staff.seniorName).toBe('Constraint Probe');
      expect(senior.role).toBe('SENIOR');
      expect(view.staff.juniorNames).toEqual([]);
    });
  });

  it('Scenario: the portfolio — 4,000 and 7,500 accounts invest 9,775 for 1,725 profit; one missed day, one overdue, last paid on the 5th', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const person = await w.customer();
      const small = await w.account(person.id, '4000'); // I 3,400 · P 600
      const large = await w.account(person.id, '7500'); // I 6,375 · P 1,125
      // Nobody came on the first slot of the small account (BR-09).
      const first = await tx.accountSchedule.findFirstOrThrow({
        where: { accountLoanId: small.id },
        orderBy: { sequence: 'asc' },
      });
      await tx.accountSchedule.update({
        where: { id: first.id },
        data: { status: 'MISSED' },
      });
      await tx.accountLoan.update({
        where: { id: large.id },
        data: { isOverdue: true },
      });
      // Paid on the 5th; on the 6th a visit with nothing paid, which is not
      // a payment and must not move "last paid".
      const collection = (day: string, amount: string) =>
        tx.collection.create({
          data: {
            idempotencyKey: randomUUID(),
            accountLoanId: large.id,
            lineId: w.line.id,
            collectedByUserId: w.context.userId,
            businessDate: new Date(day),
            capturedAt: new Date(`${day}T05:00:00Z`),
            syncedAt: new Date(`${day}T05:00:00Z`),
            expectedAmount: '100.00',
            amount,
            variance: amount === '0.00' ? '-100.00' : '0.00',
            classification: amount === '0.00' ? 'NO_PAYMENT' : 'CORRECT',
          },
        });
      await collection('2026-01-05', '100.00');
      await collection('2026-01-06', '0.00');

      const view = await w.overview.get(w.context, person.id, SATURDAY);

      expect(view).toMatchObject({
        investedTotal: '9775.00',
        profitTotal: '1725.00',
        missedDays: 1,
        overdueAccounts: 1,
        lastPaidOn: '2026-01-05',
      });
    });
  });

  it('a Junior sees the portfolio without invested amount or profit', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const person = await w.customer();
      await w.account(person.id, '4000');
      const junior = await createStaff(tx, w.organizationId, 'JUNIOR');

      const view = await w.overview.get(
        {
          ...w.context,
          userId: junior.userId,
          staffProfileId: junior.id,
          role: 'JUNIOR',
          currentLineId: w.line.id,
        },
        person.id,
        SATURDAY,
      );

      expect(view.outstandingTotal).toBe('4000.00');
      expect(view.investedTotal).toBeNull();
      expect(view.profitTotal).toBeNull();
      expect(view.lastPaidOn).toBeNull();
    });
  });

  describe('the line portfolio (J-09)', () => {
    const MONDAY = parseCalendarDate('2026-01-05');

    it('Scenario: two customers in visiting order — 11,500 outstanding, one overdue, 100 collected this week, one paid today', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const lakshmi = await w.customer('Lakshmi');
        const ravi = await w.customer('Ravi');
        await w.account(lakshmi.id, '4000');
        const overdue = await w.account(ravi.id, '7500');
        await tx.accountLoan.update({
          where: { id: overdue.id },
          data: { isOverdue: true },
        });
        // Ravi is visited first.
        await tx.customer.update({
          where: { id: ravi.id },
          data: { routePosition: 1 },
        });
        await tx.customer.update({
          where: { id: lakshmi.id },
          data: { routePosition: 2 },
        });
        const lakshmiAccount = await tx.accountLoan.findFirstOrThrow({
          where: { customerId: lakshmi.id },
        });
        await tx.collection.create({
          data: {
            idempotencyKey: randomUUID(),
            accountLoanId: lakshmiAccount.id,
            lineId: w.line.id,
            collectedByUserId: w.context.userId,
            businessDate: new Date('2026-01-05'),
            capturedAt: new Date('2026-01-05T05:00:00Z'),
            syncedAt: new Date('2026-01-05T05:00:00Z'),
            expectedAmount: '100.00',
            amount: '100.00',
            variance: '0.00',
            classification: 'CORRECT',
          },
        });
        const junior = await createStaff(tx, w.organizationId, 'JUNIOR');
        const portfolio = new LinePortfolioService(new Database(tx));

        const view = await portfolio.get(
          {
            ...w.context,
            userId: junior.userId,
            staffProfileId: junior.id,
            role: 'JUNIOR',
            currentLineId: w.line.id,
          },
          w.line.id,
          MONDAY,
        );

        expect(view.totals).toEqual({
          outstandingTotal: '11500.00',
          activeAccounts: 2,
          overdueCustomers: 1,
          collectedLastSevenDays: '100.00',
        });
        expect(
          view.customers.map((row) => [
            row.name,
            row.position,
            row.outstandingTotal,
            row.overdue,
            row.dueToday,
            row.paidToday,
          ]),
        ).toEqual([
          ['Ravi', 1, '7500.00', true, true, false],
          ['Lakshmi', 2, '4000.00', false, true, true],
        ]);
        // The one shape a Junior may see: nothing about the margin.
        expect(JSON.stringify(view)).not.toMatch(/invested|profit/i);
      });
    });

    it('a Senior of another line is told the line does not exist (404, M02)', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const elsewhere = await tx.line.create({
          data: {
            organizationId: w.organizationId,
            sectorId: w.line.sectorId,
            code: `L-${randomUUID()}`,
            name: 'Elsewhere',
          },
        });
        const portfolio = new LinePortfolioService(new Database(tx));

        await expect(
          portfolio.get(
            { ...w.context, role: 'SENIOR', currentLineId: elsewhere.id },
            w.line.id,
            MONDAY,
          ),
        ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      });
    });
  });

  it('a customer in another organization is not found', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const elsewhere = await world(tx);
      const theirs = await elsewhere.customer('Far away');

      await expect(
        w.overview.get(w.context, theirs.id, SATURDAY),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
    });
  });
});
