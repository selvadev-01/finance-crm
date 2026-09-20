import type { PrismaClient } from '@repo/db';
import { openLinePeriod } from '../database.js';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { OperationsDashboardService } from '../../src/dashboards/operations-dashboard.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld, counts, MONDAY, SATURDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * The Admin operational dashboard (M11, US-082, S-20) against real rows,
 * rolled back — it reads collections, closes and ledger postings, which
 * reject DELETE, so this tier is where its figures are proven.
 *
 * Reference accounts, disbursed Saturday 3 January 2026, first slot Monday 5:
 * three on Line A at ₹500 a day (A 10,000 / I 8,500 / P 1,500 — the PDF's
 * figures) and one on Line B at ₹100 a day (A 2,000 / I 1,700 / P 300).
 */
describe('OperationsDashboardService (US-082)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const MONDAY_EVENING = at('2026-01-05', '20:00:00');
  const TUESDAY = at('2026-01-06', '10:00:00');

  async function world(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const organizationId = w.organizationId;
    const sectorId = w.line.sectorId;

    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const settlement = new AccountSettlement(database);
    const { notices } = testNotifications(database);
    const accounts = new AccountService(database, audit, ledger);
    const collections = new CollectionService(
      database,
      audit,
      ledger,
      { warn: () => undefined } as unknown as PinoLogger,
      settlement,
      w.dayCloses,
      notices,
    );
    const corrections = new CorrectionService(
      database,
      audit,
      ledger,
      settlement,
      new CollectionHistoryService(database),
      w.dayCloses,
      notices,
    );

    // Line B's Junior; Line C has nobody and no customers.
    const staffB = await createStaff(tx, organizationId, 'JUNIOR');
    await tx.lineAssignment.create({
      data: {
        lineId: w.otherLine.id,
        staffProfileId: staffB.id,
        assignmentRole: 'JUNIOR',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    const juniorB: RequestContext = {
      requestId: 'req_test',
      userId: staffB.userId,
      staffProfileId: staffB.id,
      organizationId,
      role: 'JUNIOR',
      currentLineId: w.otherLine.id,
    };
    const idleLine = await tx.line.create({
      data: {
        organizationId,
        sectorId,
        code: `L-${randomUUID()}`,
        name: 'Idle line',
      },
    });

    const customer = (name: string, lineId: string) =>
      tx.customer.create({
        data: {
          organizationId,
          customerCode: `C-${randomUUID()}`,
          name,
          mobile: '+919800000001',
          address: '12 Market Road',
          sectorId,
          lineId,
          linePeriods: openLinePeriod(lineId),
        },
      });

    /** A = 20 × D, I = 17 × D: ₹500 a day is the PDF's 10,000 / 8,500 / 1,500. */
    const account = async (name: string, lineId: string, daily: string) =>
      accounts.create(
        w.admin,
        {
          customerId: (await customer(name, lineId)).id,
          accountAmount: toMoney(daily).times(20).toFixed(2),
          investedAmount: toMoney(daily).times(17).toFixed(2),
          dailyAmount: daily,
          termDays: 20,
          disbursementDate: SATURDAY,
          disburse: true,
        },
        SATURDAY,
      );

    const collect = async (
      junior: RequestContext,
      accountLoanId: string,
      amount: string,
    ) =>
      (
        await collections.record(
          junior,
          {
            idempotencyKey: randomUUID(),
            accountLoanId,
            amount,
            capturedAt: at('2026-01-05').toISOString(),
            note: undefined,
          },
          at('2026-01-05', '18:00:00'),
        )
      ).collection;

    const logger = { error: vi.fn() };
    const dashboard = new OperationsDashboardService(
      database,
      logger as unknown as PinoLogger,
    );
    return {
      ...w,
      juniorB,
      idleLine,
      customer,
      account,
      collect,
      corrections,
      dashboard,
      logger,
    };
  }

  /**
   * Line A: Anbu pays 500 (correct), Bala 400 (low), Chitra is not visited.
   * Line B: Deepa pays 150 against 100 (extra).
   */
  async function monday(tx: PrismaClient) {
    const w = await world(tx);
    const anbu = await w.account('Anbu', w.line.id, '500');
    const bala = await w.account('Bala', w.line.id, '500');
    await w.account('Chitra', w.line.id, '500');
    const deepa = await w.account('Deepa', w.otherLine.id, '100');
    await w.collect(w.junior, anbu.id, '500');
    const low = await w.collect(w.junior, bala.id, '400');
    const extra = await w.collect(w.juniorB, deepa.id, '150');
    return { w, anbu, bala, deepa, low, extra };
  }

  it('Scenario: Monday on three lines — expected 1,600, collected 1,050, 600 pending on Line A and 50 extra on Line B, one low and one extra entry', async () => {
    await withRollback(prisma, async (tx) => {
      const { w } = await monday(tx);

      const view = await w.dashboard.view(w.admin, undefined, MONDAY_EVENING);
      expect(view).toMatchObject({
        businessDate: '2026-01-05',
        day: { kind: 'WORKING' },
        today: {
          expected: '1600.00',
          collected: '1050.00',
          // Per line: A is 600 short, B is 50 over — the surplus does not
          // hide the shortfall (BR-16).
          pending: '600.00',
          extra: '50.00',
          lowCount: 1,
          extraCount: 1,
          linesToClose: 3,
          linesNotClosed: 3,
        },
        accounts: { total: 4, active: 4, completed: 0 },
        // BR-18 disbursement postings: 3 × 8,500 + 1,700 and 3 × 1,500 + 300.
        investment: { invested: '27200.00', profit: '4800.00' },
        sectors: [
          {
            sectorId: w.line.sectorId,
            lineCount: 3,
            activeAccounts: 4,
            expected: '1600.00',
            collected: '1050.00',
          },
        ],
      });
      const byId = new Map(view.lines!.map((line) => [line.lineId, line]));
      expect(byId.get(w.line.id)).toMatchObject({
        status: 'OPEN',
        expected: '1500.00',
        collected: '900.00',
        lowCount: 1,
        extraCount: 0,
        missedCount: 0,
        seniorName: expect.any(String),
        juniorCount: 1,
        activeAccounts: 3,
      });
      expect(byId.get(w.otherLine.id)).toMatchObject({
        expected: '100.00',
        collected: '150.00',
        extraCount: 1,
        juniorCount: 1,
        activeAccounts: 1,
      });
      expect(byId.get(w.idleLine.id)).toMatchObject({
        expected: '0.00',
        collected: '0.00',
        seniorName: null,
        juniorCount: 0,
        activeAccounts: 0,
      });
      // Today: an open day is work in progress, not yet something to chase.
      expect(view.attention).toEqual([
        {
          kind: 'NO_SENIOR',
          lineId: w.idleLine.id,
          lineCode: w.idleLine.code,
          lineName: 'Idle line',
        },
      ]);
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('agrees with the day close to the paisa for the same line and date (S-05)', async () => {
    await withRollback(prisma, async (tx) => {
      const { w } = await monday(tx);
      const view = await w.dashboard.view(w.admin, MONDAY, MONDAY_EVENING);
      for (const lineId of [w.line.id, w.otherLine.id]) {
        const day = await w.dayCloses.view(
          w.admin,
          lineId,
          MONDAY,
          MONDAY_EVENING,
        );
        const line = view.lines!.find((row) => row.lineId === lineId)!;
        expect([line.expected, line.collected]).toEqual([
          day.expectedTotal,
          day.collectedTotal,
        ]);
      }
    });
  });

  it('Scenario: closing Line A marks Chitra missed; corrections wait — one for this Admin, one of their own for someone else', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, low, extra } = await monday(tx);
      await w.corrections.request(
        w.junior,
        low.id,
        { correctedAmount: '450', reason: 'Paid 450, typed 400' },
        MONDAY_EVENING,
      );
      await w.corrections.reverse(
        w.admin,
        extra.id,
        { reason: 'Recorded on the wrong account' },
        MONDAY_EVENING,
      );
      await w.synced();
      await w.dayCloses.close(
        w.senior,
        w.line.id,
        MONDAY,
        false,
        MONDAY_EVENING,
      );

      const view = await w.dashboard.view(w.admin, MONDAY, MONDAY_EVENING);
      // A correction moves nothing until approved (US-044).
      expect(view.today).toMatchObject({
        collected: '1050.00',
        linesToClose: 3,
        linesNotClosed: 2,
      });
      expect(view.pendingApprovals).toEqual({ total: 2, awaitingYou: 1 });
      expect(
        view.lines!.find((line) => line.lineId === w.line.id),
      ).toMatchObject({ status: 'CLOSED', missedCount: 1 });
      expect(view.attention!.map((item) => item.kind)).toEqual([
        'MISSED',
        'PENDING_APPROVALS',
        'NO_SENIOR',
      ]);
      expect(view.attention![0]).toEqual({
        kind: 'MISSED',
        lineId: w.line.id,
        lineCode: w.line.code,
        lineName: w.line.name,
        count: 1,
      });
      expect(view.attention![1]).toEqual({
        kind: 'PENDING_APPROVALS',
        count: 2,
        awaitingYou: 1,
      });
    });
  });

  it('Scenario: looking back from Tuesday — unclosed days, a disputed handover, and a line with accounts but no Junior', async () => {
    await withRollback(prisma, async (tx) => {
      const { w } = await monday(tx);
      // Line B's Junior leaves on Monday: from Tuesday Deepa has nobody.
      await tx.lineAssignment.updateMany({
        where: { lineId: w.otherLine.id, assignmentRole: 'JUNIOR' },
        data: { effectiveTo: new Date('2026-01-05') },
      });
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          // ₹880 against ₹900 recorded: one ₹20 note short.
          counts: counts({ 500: 1, 200: 1, 100: 1, 50: 1, 20: 1, 10: 1 }),
          note: 'Customer paid in change',
        },
        at('2026-01-05', '19:00:00'),
      );
      await w.handovers.dispute(w.senior, handover.id, 'One ₹20 note short');

      const past = await w.dashboard.view(w.admin, MONDAY, TUESDAY);
      expect(past.attention).toEqual([
        {
          kind: 'DISPUTED_HANDOVER',
          handoverId: handover.id,
          lineId: w.line.id,
          lineCode: w.line.code,
          lineName: w.line.name,
          businessDate: '2026-01-05',
          fromName: expect.any(String),
          discrepancy: '-20.00',
        },
        // Every line, in the list's own (code) order.
        ...past.lines!.map((line) => ({
          kind: 'DAY_NOT_CLOSED',
          lineId: line.lineId,
          lineCode: line.code,
          lineName: line.name,
          status: 'OPEN',
        })),
        {
          kind: 'NO_SENIOR',
          lineId: w.idleLine.id,
          lineCode: w.idleLine.code,
          lineName: 'Idle line',
        },
      ]);

      const tuesday = await w.dashboard.view(w.admin, undefined, TUESDAY);
      expect(tuesday.businessDate).toBe('2026-01-06');
      expect(
        tuesday.attention!.find((item) => item.kind === 'NO_JUNIOR'),
      ).toEqual({
        kind: 'NO_JUNIOR',
        lineId: w.otherLine.id,
        lineCode: w.otherLine.code,
        lineName: w.otherLine.name,
      });
      // Tuesday's slots are due; nothing is collected yet.
      expect(tuesday.today).toMatchObject({
        expected: '1600.00',
        collected: '0.00',
        pending: '1600.00',
        extra: '0.00',
      });
    });
  });

  it('counts customers onboarded on the business date in Asia/Kolkata, and active customers as those holding an active account', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, anbu, bala } = await monday(tx);
      const setCreated = (accountLoanId: string, instant: Date) =>
        tx.customer.updateMany({
          where: { accountLoans: { some: { id: accountLoanId } } },
          data: { createdAt: instant },
        });
      // 00:10 IST Monday is still Sunday in UTC; 23:30 IST Sunday is not Monday.
      await setCreated(anbu.id, at('2026-01-05', '00:10:00'));
      await setCreated(bala.id, at('2026-01-04', '23:30:00'));
      const walkIn = await w.customer('Ezhil', w.line.id);
      await tx.customer.update({
        where: { id: walkIn.id },
        data: { createdAt: at('2026-01-05', '23:50:00') },
      });

      const view = await w.dashboard.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.customers).toEqual({ new: 2, active: 4 });
    });
  });

  it('Sunday and a declared holiday carry no collections, so no line is waiting to close; a future date is refused', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const sunday = await w.dashboard.view(
        w.admin,
        parseCalendarDate('2026-01-04'),
        MONDAY_EVENING,
      );
      expect(sunday.day).toEqual({ kind: 'SUNDAY' });
      expect(sunday.today).toMatchObject({
        linesToClose: 0,
        linesNotClosed: 0,
      });

      await tx.holiday.create({
        data: {
          organizationId: w.organizationId,
          sectorId: w.line.sectorId,
          date: new Date('2026-01-07'),
          name: 'Pongal',
        },
      });
      const wednesday = await w.dashboard.view(
        w.admin,
        parseCalendarDate('2026-01-07'),
        at('2026-01-07', '12:00:00'),
      );
      // A sector holiday is not business-wide, but every line here is in it.
      expect(wednesday.day).toEqual({ kind: 'WORKING' });
      expect(wednesday.lines!.map((line) => line.day)).toEqual([
        { kind: 'HOLIDAY', name: 'Pongal' },
        { kind: 'HOLIDAY', name: 'Pongal' },
        { kind: 'HOLIDAY', name: 'Pongal' },
      ]);
      expect(wednesday.today).toMatchObject({ linesToClose: 0 });

      await expect(
        w.dashboard.view(
          w.admin,
          parseCalendarDate('2026-01-06'),
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
    });
  });

  it('S-07: a figure that cannot be read is null, never zero — the rest still arrive', async () => {
    await withRollback(prisma, async (tx) => {
      const { w } = await monday(tx);
      const failing = (model: string, method: string) =>
        new Proxy(tx, {
          get(target, property) {
            if (property === model) {
              return {
                [method]: () => Promise.reject(new Error('connection lost')),
              };
            }
            const value: unknown = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      const logger = { error: vi.fn() };
      const withoutLedger = new OperationsDashboardService(
        new Database(failing('ledgerEntry', 'aggregate')),
        logger as unknown as PinoLogger,
      );
      const noLedger = await withoutLedger.view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(noLedger.investment).toBeNull();
      expect(noLedger.today).toMatchObject({ expected: '1600.00' });
      expect(noLedger.accounts).toEqual({ total: 4, active: 4, completed: 0 });
      expect(noLedger.attention).not.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: investment',
      );

      const withoutLines = new OperationsDashboardService(
        new Database(failing('line', 'findMany')),
        logger as unknown as PinoLogger,
      );
      const noLines = await withoutLines.view(w.admin, MONDAY, MONDAY_EVENING);
      // Everything built from the lines is unknown too — including the list
      // of what needs attention, which would otherwise look all clear.
      expect(noLines).toMatchObject({
        lines: null,
        today: null,
        sectors: null,
        attention: null,
        investment: { invested: '27200.00', profit: '4800.00' },
        pendingApprovals: { total: 0, awaitingYou: 0 },
      });
    });
  });

  it("counts only the caller's organization", async () => {
    await withRollback(prisma, async (tx) => {
      const { w } = await monday(tx);
      const other = await world(tx);
      await other.account('Farook', other.line.id, '500');

      const view = await w.dashboard.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.accounts).toEqual({ total: 4, active: 4, completed: 0 });
      expect(view.investment).toEqual({
        invested: '27200.00',
        profit: '4800.00',
      });
      expect(view.lines).toHaveLength(3);
      const theirs = await other.dashboard.view(
        other.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(theirs.investment).toEqual({
        invested: '8500.00',
        profit: '1500.00',
      });
    });
  });
});
