import type { PrismaClient } from '@repo/db';
import { openLinePeriod } from '../database.js';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { DayCloseService } from '../../src/cash/day-close.service.js';
import { DeviceSyncService } from '../../src/cash/device-sync.service.js';
import { HandoverViews } from '../../src/cash/handover-views.js';
import { HandoverService } from '../../src/cash/handover.service.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';

/**
 * A line with an Admin, its Senior and a Junior assigned from 1 January 2026,
 * the real services wired over one rolled-back transaction, and helpers to
 * create disbursed accounts and record collections. Day one is Saturday
 * 3 January; the first slot of every account is due Monday 5 January.
 */
export const SATURDAY = parseCalendarDate('2026-01-03');
export const MONDAY = parseCalendarDate('2026-01-05');
/** A moment on a business date, IST. */
export const at = (date: string, time = '10:00:00') =>
  new Date(`${date}T${time}+05:30`);

export async function cashWorld(tx: PrismaClient) {
  const { organization, sector, line } = await createLine(tx);
  const organizationId = organization.id;
  const { line: otherLine } = await (async () => {
    const created = await tx.line.create({
      data: {
        organizationId,
        sectorId: sector.id,
        code: `L-${randomUUID()}`,
        name: 'Other line',
      },
    });
    return { line: created };
  })();

  const person = async (
    role: RequestContext['role'],
    currentLineId: string | null,
    assign: 'SENIOR' | 'JUNIOR' | null,
  ): Promise<RequestContext> => {
    const staff = await createStaff(
      tx,
      organizationId,
      role === 'SUPER_ADMIN' ? 'ADMIN' : role,
    );
    if (assign && currentLineId) {
      await tx.lineAssignment.create({
        data: {
          lineId: currentLineId,
          staffProfileId: staff.id,
          assignmentRole: assign,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
    return {
      requestId: 'req_test',
      userId: staff.userId,
      staffProfileId: staff.id,
      organizationId,
      role,
      currentLineId,
    };
  };
  const admin = await person('ADMIN', null, null);
  const senior = await person('SENIOR', line.id, 'SENIOR');
  const junior = await person('JUNIOR', line.id, 'JUNIOR');
  const otherSenior = await person('SENIOR', otherLine.id, 'SENIOR');

  const database = new Database(tx);
  const audit = new AuditWriter(database);
  const ledger = new LedgerService(database);
  const settlement = new AccountSettlement(database);
  const views = new HandoverViews();
  const { notices, recipients } = testNotifications(database);
  const dayCloses = new DayCloseService(
    database,
    audit,
    settlement,
    views,
    notices,
  );
  const handovers = new HandoverService(
    database,
    audit,
    ledger,
    dayCloses,
    views,
    notices,
  );
  const devices = new DeviceSyncService(database);
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

  /** A disbursed account on the line: first slot due Monday 5 January. */
  const account = async (dailyAmount: string, name = 'Lakshmi') => {
    const customer = await tx.customer.create({
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
    return accounts.create(
      admin,
      {
        customerId: customer.id,
        accountAmount: toMoney(dailyAmount).times(20).toFixed(2),
        investedAmount: toMoney(dailyAmount).times(17).toFixed(2),
        dailyAmount,
        termDays: 20,
        disbursementDate: SATURDAY,
        disburse: true,
      },
      SATURDAY,
    );
  };

  /** Recorded by the Junior, captured and synced on `date`. */
  const collect = async (
    accountLoanId: string,
    amount: string,
    date = '2026-01-05',
    syncedOn = date,
  ) =>
    (
      await collections.record(
        junior,
        {
          idempotencyKey: randomUUID(),
          accountLoanId,
          amount,
          capturedAt: at(date).toISOString(),
          note: undefined,
        },
        at(syncedOn, '21:00:00'),
      )
    ).collection;

  /** The phone reports an empty queue on `date`, so closing does not warn. */
  const synced = (date = '2026-01-05') =>
    devices.report(junior, { unsentCount: 0 }, at(date, '19:00:00'));

  const cash = async (userId: string) => {
    const rows = await tx.ledgerAccount.findMany({
      where: {
        organizationId,
        OR: [{ ownerUserId: userId }, { accountType: 'CASH_AT_OFFICE' }],
      },
    });
    const own = rows.find((row) => row.ownerUserId === userId);
    const office = rows.find((row) => row.accountType === 'CASH_AT_OFFICE');
    return {
      own: own?.balance.toFixed(2) ?? '0.00',
      office: office?.balance.toFixed(2) ?? '0.00',
    };
  };

  return {
    tx,
    organizationId,
    accounts,
    line,
    otherLine,
    admin,
    senior,
    junior,
    otherSenior,
    dayCloses,
    handovers,
    devices,
    account,
    collect,
    synced,
    cash,
    notices,
    recipients,
  };
}

/** Nine counts from a map of denomination → count. */
export const counts = (map: Record<number, number>) =>
  Object.entries(map).map(([denomination, count]) => ({
    denomination: Number(denomination) as 500,
    count,
  }));
