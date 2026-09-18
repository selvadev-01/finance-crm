import type { PrismaClient } from '@repo/db';
import { toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { Mock } from 'vitest';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { BusinessOverviewService } from '../../src/dashboards/business-overview.service.js';
import { OperationsDashboardService } from '../../src/dashboards/operations-dashboard.service.js';
import { SectorComparisonService } from '../../src/dashboards/sector-comparison.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { CollectionReportService } from '../../src/reports/collection-report.service.js';
import { DiscrepancyReportService } from '../../src/reports/discrepancy-report.service.js';
import { InvestmentReportService } from '../../src/reports/investment-report.service.js';
import { LineWiseReportService } from '../../src/reports/line-wise-report.service.js';
import { OverdueReportService } from '../../src/reports/overdue-report.service.js';
import { at, cashWorld, SATURDAY } from '../cash/world.js';
import { createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';

/**
 * The business-wide dashboards' world (US-080, US-081, US-082), for Tier 1
 * only — it disburses and collects, so it must run inside `withRollback`.
 *
 * Two sectors. North holds Line A (`line`) and Line B (`otherLine`); South
 * holds Line C. `account` disburses A = 20 × D, I = 17 × D on Saturday
 * 3 January 2026 — ₹500 a day is the PDF's 10,000 / 8,500 / 1,500 — with its
 * first slot on Monday 5.
 */
export async function businessWorld(tx: PrismaClient) {
  const w = await cashWorld(tx);
  const organizationId = w.organizationId;
  const north = w.line.sectorId;

  const database = new Database(tx);
  const audit = new AuditWriter(database);
  const ledger = new LedgerService(database);
  const { notices } = testNotifications(database);
  const accounts = new AccountService(database, audit, ledger);
  const collections = new CollectionService(
    database,
    audit,
    ledger,
    { warn: () => undefined } as unknown as PinoLogger,
    new AccountSettlement(database),
    w.dayCloses,
    notices,
  );

  const south = await tx.sector.create({
    data: { organizationId, code: `S-${randomUUID()}`, name: 'South' },
  });
  const lineC = await tx.line.create({
    data: {
      organizationId,
      sectorId: south.id,
      code: `L-${randomUUID()}`,
      name: 'Line C',
    },
  });

  const junior = async (lineId: string): Promise<RequestContext> => {
    const staff = await createStaff(tx, organizationId, 'JUNIOR');
    await tx.lineAssignment.create({
      data: {
        lineId,
        staffProfileId: staff.id,
        assignmentRole: 'JUNIOR',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    return {
      requestId: 'req_test',
      userId: staff.userId,
      staffProfileId: staff.id,
      organizationId,
      role: 'JUNIOR',
      currentLineId: lineId,
    };
  };
  const juniorB = await junior(w.otherLine.id);
  const juniorC = await junior(lineC.id);

  const account = async (lineId: string, sectorId: string, daily: string) => {
    const customer = await tx.customer.create({
      data: {
        organizationId,
        customerCode: `C-${randomUUID()}`,
        name: 'Customer',
        mobile: '+919800000001',
        address: '12 Market Road',
        sectorId,
        lineId,
      },
    });
    return accounts.create(
      w.admin,
      {
        customerId: customer.id,
        accountAmount: toMoney(daily).times(20).toFixed(2),
        investedAmount: toMoney(daily).times(17).toFixed(2),
        dailyAmount: daily,
        termDays: 20,
        disbursementDate: SATURDAY,
        disburse: true,
      },
      SATURDAY,
    );
  };

  const collect = (
    who: RequestContext,
    accountLoanId: string,
    amount: string,
    date = '2026-01-05',
  ) =>
    collections.record(
      who,
      {
        idempotencyKey: randomUUID(),
        accountLoanId,
        amount,
        capturedAt: at(date).toISOString(),
        note: undefined,
      },
      at(date, '18:00:00'),
    );

  const superAdmin: RequestContext = { ...w.admin, role: 'SUPER_ADMIN' };
  const logger: { error: Mock } = { error: vi.fn() };
  const asLogger = logger as unknown as PinoLogger;
  return {
    ...w,
    database,
    north,
    south,
    lineC,
    juniorB,
    juniorC,
    /** For terms the shaped `account` helper cannot express (US-085's uneven A). */
    accounts,
    account,
    collect,
    /** Another Junior on a line — the discrepancy report is per Junior (BR-17). */
    addJunior: junior,
    superAdmin,
    overview: new BusinessOverviewService(database, asLogger),
    operations: new OperationsDashboardService(database, asLogger),
    sectors: new SectorComparisonService(database, asLogger),
    lineWise: new LineWiseReportService(database, asLogger),
    investment: new InvestmentReportService(database, asLogger),
    collectionReport: new CollectionReportService(database, asLogger),
    overdue: new OverdueReportService(database, asLogger),
    discrepancies: new DiscrepancyReportService(database, asLogger),
    logger,
  };
}

/**
 * Monday 5 January. Line A: 500 (correct) and 400 (low). Line B: 150 against
 * 100 (extra). Line C: 300 (correct).
 */
export async function businessMonday(tx: PrismaClient) {
  const w = await businessWorld(tx);
  const a1 = await w.account(w.line.id, w.north, '500');
  const a2 = await w.account(w.line.id, w.north, '500');
  const b1 = await w.account(w.otherLine.id, w.north, '100');
  const c1 = await w.account(w.lineC.id, w.south.id, '300');
  await w.collect(w.junior, a1.id, '500');
  await w.collect(w.junior, a2.id, '400');
  await w.collect(w.juniorB, b1.id, '150');
  await w.collect(w.juniorC, c1.id, '300');
  return w;
}

/**
 * A Prisma client whose `model.method` rejects, every other query still
 * working — S-07's partial failure, one group at a time.
 */
export function failingClient(
  tx: PrismaClient,
  model: string,
  method: string,
): PrismaClient {
  return new Proxy(tx, {
    get(target, property) {
      if (property === model) {
        const delegate = Reflect.get(target, property) as object;
        return new Proxy(delegate, {
          get(inner, name) {
            if (name === method) {
              return () => Promise.reject(new Error('connection lost'));
            }
            const value: unknown = Reflect.get(inner, name);
            return typeof value === 'function' ? value.bind(inner) : value;
          },
        });
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
