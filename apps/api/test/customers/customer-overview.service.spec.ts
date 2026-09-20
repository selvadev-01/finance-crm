import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CustomerOverviewService } from '../../src/customers/customer-overview.service.js';
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
