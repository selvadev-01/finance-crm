import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CollectionService } from '../../src/collections/collection.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { LineDashboardService } from '../../src/dashboards/line-dashboard.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { SettingReader } from '../../src/settings/setting-reader.js';
import { at, cashWorld, counts, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * The Senior line dashboard (M11, US-083, S-19) against real rows, rolled
 * back — it reads collections, handovers and closes, which reject DELETE.
 *
 * Line A, Monday 5 January 2026, four accounts at ₹500 a day (disbursed
 * Saturday 3 January): Priya collects Anbu 500 (correct) and Bala 400 (low);
 * Murugan collects Devi 600 (extra); Chitra is not visited. Expected 2,000,
 * collected 1,500, so the line is ₹500 short.
 */
describe('LineDashboardService (US-083)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const MONDAY_EVENING = at('2026-01-05', '20:00:00');

  async function monday(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const settlement = new AccountSettlement(database);
    const { notices } = testNotifications(database);
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

    // A second Junior on Line A, whose phone never reports.
    const staff = await createStaff(tx, w.organizationId, 'JUNIOR');
    await tx.lineAssignment.create({
      data: {
        lineId: w.line.id,
        staffProfileId: staff.id,
        assignmentRole: 'JUNIOR',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    const murugan: RequestContext = {
      ...w.junior,
      userId: staff.userId,
      staffProfileId: staff.id,
    };

    const anbu = await w.account('500', 'Anbu');
    const bala = await w.account('500', 'Bala');
    const chitra = await w.account('500', 'Chitra');
    const devi = await w.account('500', 'Devi');
    await w.collect(anbu.id, '500');
    const low = await w.collect(bala.id, '400');
    await collections.record(
      murugan,
      {
        idempotencyKey: randomUUID(),
        accountLoanId: devi.id,
        amount: '600',
        capturedAt: at('2026-01-05').toISOString(),
        note: undefined,
      },
      at('2026-01-05', '18:00:00'),
    );
    await w.synced();

    const logger = { error: vi.fn() };
    const dashboard = new LineDashboardService(
      database,
      w.dayCloses,
      logger as unknown as PinoLogger,
      new SettingReader(database),
    );
    return {
      w,
      murugan,
      anbu,
      bala,
      chitra,
      devi,
      low,
      corrections,
      dashboard,
      logger,
    };
  }

  it("Scenario: the Senior's Monday — expected 2,000, collected 1,500, ₹500 short; each Junior's entries and phone; the low, extra and unvisited entries", async () => {
    await withRollback(prisma, async (tx) => {
      const { w, murugan, bala, chitra, devi, dashboard, logger } =
        await monday(tx);

      const view = await dashboard.view(w.senior, {}, MONDAY_EVENING);
      if (view.state !== 'LINE') throw new Error('expected a line');
      expect(view.line).toEqual({
        lineId: w.line.id,
        code: w.line.code,
        name: w.line.name,
        sectorName: 'Sector',
      });
      expect(view.businessDate).toBe('2026-01-05');
      expect(view.day).toMatchObject({
        day: { kind: 'WORKING' },
        status: 'OPEN',
        expected: '2000.00',
        collected: '1500.00',
        shortfall: '500.00',
        surplus: '0.00',
        cashReceived: '0.00',
        discrepancy: '-1500.00',
        cashHandedOver: false,
        handovers: { waiting: 0, disputed: 0 },
      });
      const juniors = new Map(
        view.day!.juniors.map((junior) => [junior.userId, junior]),
      );
      expect(juniors.get(w.junior.userId)).toMatchObject({
        entries: 2,
        collectedAmount: '900.00',
        sync: 'SENT',
      });
      expect(juniors.get(murugan.userId)).toMatchObject({
        entries: 1,
        collectedAmount: '600.00',
        sync: 'NOT_HEARD',
      });
      expect(
        view.day!.exceptions.map((entry) => [entry.kind, entry.accountLoanId]),
      ).toEqual([
        ['LOW', bala.id],
        ['EXTRA', devi.id],
        ['NOT_VISITED', chitra.id],
      ]);
      expect(view.pendingApprovals).toEqual({ total: 0, awaitingYou: 0 });
      expect(view.nearingCompletion).toEqual({ total: 0, items: [] });
      expect(view.overdue).toEqual({ total: 0, items: [] });
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  it('Scenario: cash received and its discrepancy as the day close computes them — ₹900 acknowledged against ₹1,500 recorded is ₹600 short', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, dashboard } = await monday(tx);
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 500: 1, 200: 2 }),
          note: undefined,
        },
        at('2026-01-05', '19:00:00'),
      );
      const waiting = await dashboard.view(w.senior, {}, MONDAY_EVENING);
      if (waiting.state !== 'LINE') throw new Error('expected a line');
      expect(waiting.day).toMatchObject({
        cashReceived: '0.00',
        cashHandedOver: false,
        handovers: { waiting: 1, disputed: 0 },
      });

      await w.handovers.acknowledge(w.senior, handover.id, MONDAY_EVENING);
      const view = await dashboard.view(w.senior, {}, MONDAY_EVENING);
      if (view.state !== 'LINE') throw new Error('expected a line');
      expect(view.day).toMatchObject({
        cashReceived: '900.00',
        discrepancy: '-600.00',
        cashHandedOver: true,
        handovers: { waiting: 0, disputed: 0 },
      });
    });
  });

  it('a correction waiting for approval is not counted in collected (US-044), and is listed for the Senior to decide', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, low, corrections, dashboard } = await monday(tx);
      await corrections.request(
        w.junior,
        low.id,
        { correctedAmount: '450', reason: 'Paid 450, typed 400' },
        MONDAY_EVENING,
      );
      const view = await dashboard.view(w.senior, {}, MONDAY_EVENING);
      if (view.state !== 'LINE') throw new Error('expected a line');
      expect(view.day).toMatchObject({
        collected: '1500.00',
        shortfall: '500.00',
      });
      expect(view.pendingApprovals).toEqual({ total: 1, awaitingYou: 1 });

      // The other line's Senior sees none of it.
      const other = await dashboard.view(w.otherSenior, {}, MONDAY_EVENING);
      if (other.state !== 'LINE') throw new Error('expected a line');
      expect(other.pendingApprovals).toEqual({ total: 0, awaitingYou: 0 });
    });
  });

  it('closing marks Chitra missed; the dashboard agrees with the day close to the paisa, before and after', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, chitra, dashboard } = await monday(tx);
      const agree = async () => {
        const view = await dashboard.view(w.senior, {}, MONDAY_EVENING);
        const day = await w.dayCloses.view(
          w.senior,
          w.line.id,
          MONDAY,
          MONDAY_EVENING,
        );
        if (view.state !== 'LINE') throw new Error('expected a line');
        expect(view.day).toMatchObject({
          status: day.status,
          expected: day.expectedTotal,
          collected: day.collectedTotal,
          cashReceived: day.cashReceivedTotal,
          discrepancy: day.discrepancy,
          juniors: day.juniors,
          exceptions: day.exceptions,
        });
        return view;
      };
      await agree();

      await w.dayCloses.close(
        w.senior,
        w.line.id,
        MONDAY,
        true,
        MONDAY_EVENING,
      );
      const closed = await agree();
      expect(closed.day).toMatchObject({
        status: 'CLOSED',
        closedByName: expect.any(String),
        closedAt: MONDAY_EVENING.toISOString(),
      });
      expect(
        closed.day!.exceptions.find(
          (entry) => entry.accountLoanId === chitra.id,
        ),
      ).toMatchObject({ kind: 'MISSED', amount: null });
    });
  });

  it('lists accounts nearing completion (five collections or fewer left) and overdue ones (BR-05), most outstanding first', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, anbu, bala, chitra, devi, dashboard } = await monday(tx);
      const set = (
        id: string,
        data: { outstandingAmount?: string; targetCompletionDate?: Date },
      ) => tx.accountLoan.update({ where: { id }, data });
      // Anbu has ₹2,500 left — exactly five days of ₹500: nearing.
      await set(anbu.id, { outstandingAmount: '2500.00' });
      // Bala has ₹2,500.01 left: not yet.
      await set(bala.id, { outstandingAmount: '2500.01' });
      // Chitra and Devi are past their targets: overdue, whatever is left.
      await set(chitra.id, {
        outstandingAmount: '1000.00',
        targetCompletionDate: new Date('2026-01-01'),
      });
      await set(devi.id, {
        outstandingAmount: '4000.00',
        targetCompletionDate: new Date('2026-01-04'),
      });
      // A target of today is not overdue yet (no grace period, but not early).
      await set((await w.account('100', 'Ezhil')).id, {
        outstandingAmount: '300.00',
        targetCompletionDate: new Date('2026-01-05'),
      });

      const view = await dashboard.view(w.senior, {}, MONDAY_EVENING);
      if (view.state !== 'LINE') throw new Error('expected a line');
      expect(view.overdue).toEqual({
        total: 2,
        items: [
          expect.objectContaining({
            accountLoanId: devi.id,
            customerName: 'Devi',
            outstanding: '4000.00',
            dailyAmount: '500.00',
            targetCompletionDate: '2026-01-04',
            daysOverdue: 1,
          }),
          expect.objectContaining({
            accountLoanId: chitra.id,
            outstanding: '1000.00',
            daysOverdue: 4,
          }),
        ],
      });
      expect(view.nearingCompletion!.total).toBe(2);
      expect(
        view.nearingCompletion!.items.map((item) => [
          item.customerName,
          item.outstanding,
          item.daysOverdue,
        ]),
      ).toEqual([
        ['Ezhil', '300.00', 0],
        ['Anbu', '2500.00', 0],
      ]);
    });
  });

  it('a Senior with no line today gets the empty state, not an error; so does an Admin who names no line', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, dashboard } = await monday(tx);
      const unassigned: RequestContext = { ...w.senior, currentLineId: null };
      await expect(
        dashboard.view(unassigned, {}, MONDAY_EVENING),
      ).resolves.toEqual({
        state: 'NO_LINE',
        businessDate: '2026-01-05',
        generatedAt: MONDAY_EVENING.toISOString(),
      });
      await expect(
        dashboard.view(w.admin, {}, MONDAY_EVENING),
      ).resolves.toMatchObject({ state: 'NO_LINE' });

      // …and naming their old line is refused like any other.
      await expect(
        dashboard.view(unassigned, { lineId: w.line.id }, MONDAY_EVENING),
      ).rejects.toMatchObject({ status: 404, code: 'LINE_NOT_FOUND' });
    });
  });

  it('another line is 404 for a Senior, exactly as a missing one; an Admin may name any line of the organization', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, dashboard } = await monday(tx);
      const refused = dashboard.view(
        w.senior,
        { lineId: w.otherLine.id },
        MONDAY_EVENING,
      );
      await expect(refused).rejects.toMatchObject({
        status: 404,
        code: 'LINE_NOT_FOUND',
      });
      await expect(
        dashboard.view(w.senior, { lineId: 'no-such-line' }, MONDAY_EVENING),
      ).rejects.toMatchObject({ status: 404, code: 'LINE_NOT_FOUND' });

      // Their own line, named, is the same as not naming it.
      const named = await dashboard.view(
        w.senior,
        { lineId: w.line.id },
        MONDAY_EVENING,
      );
      expect(named).toEqual(await dashboard.view(w.senior, {}, MONDAY_EVENING));

      const admin = await dashboard.view(
        w.admin,
        { lineId: w.line.id },
        MONDAY_EVENING,
      );
      expect(admin).toMatchObject({
        state: 'LINE',
        day: { expected: '2000.00', collected: '1500.00' },
      });

      // Another organization's line is 404 for its Admin too.
      const elsewhere = await cashWorld(tx);
      await expect(
        dashboard.view(elsewhere.admin, { lineId: w.line.id }, MONDAY_EVENING),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('takes an earlier date and refuses a future one; a figure that cannot be read is null, never zero (S-07)', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, dashboard } = await monday(tx);
      const tuesday = await dashboard.view(
        w.senior,
        { date: MONDAY },
        at('2026-01-06', '09:00:00'),
      );
      expect(tuesday).toMatchObject({
        businessDate: '2026-01-05',
        day: { collected: '1500.00' },
      });
      await expect(
        dashboard.view(
          w.senior,
          { date: parseCalendarDate('2026-01-06') },
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ status: 422, code: 'DATE_IN_FUTURE' });

      const failing = new Proxy(tx, {
        get(target, property) {
          if (property === 'accountLoan') {
            return {
              findMany: () => Promise.reject(new Error('connection lost')),
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const logger = { error: vi.fn() };
      const failingDatabase = new Database(failing);
      const partial = new LineDashboardService(
        failingDatabase,
        w.dayCloses,
        logger as unknown as PinoLogger,
        new SettingReader(failingDatabase),
      );
      const view = await partial.view(w.senior, {}, MONDAY_EVENING);
      expect(view).toMatchObject({
        state: 'LINE',
        nearingCompletion: null,
        overdue: null,
        day: { expected: '2000.00' },
        pendingApprovals: { total: 0, awaitingYou: 0 },
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: accounts',
      );
    });
  });
});
