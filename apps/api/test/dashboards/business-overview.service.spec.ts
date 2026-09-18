import type { PrismaClient } from '@repo/db';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { BusinessOverviewService } from '../../src/dashboards/business-overview.service.js';
import { Database } from '../../src/platform/database/database.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { at, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';
import {
  businessMonday,
  businessWorld,
  failingClient,
} from './business-world.js';

/**
 * The Super Admin business overview (M11, US-080, S-07) against real rows,
 * rolled back — it reads collections, closes and ledger postings, which
 * reject DELETE, so this tier is where its figures are proven. The world is
 * `business-world.ts`: North (Lines A and B) and South (Line C).
 */
describe('BusinessOverviewService (US-080)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const MONDAY_EVENING = at('2026-01-05', '20:00:00');
  const world = businessWorld;
  const monday = businessMonday;

  it('Scenario: Monday across two sectors — the thirteen figures, and each sector the sum of its lines to the paisa', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await monday(tx);
      const view = await w.overview.view(
        w.superAdmin,
        undefined,
        MONDAY_EVENING,
      );

      expect(view).toEqual({
        businessDate: '2026-01-05',
        day: { kind: 'WORKING' },
        generatedAt: MONDAY_EVENING.toISOString(),
        setupNeeded: false,
        // 1,000 + 100 + 300 expected; 900 + 150 + 300 collected. Line A is
        // 100 short and Line B 50 over — the surplus does not hide the
        // shortfall (BR-16 per line).
        today: {
          expected: '1400.00',
          collected: '1350.00',
          pending: '100.00',
          extra: '50.00',
          lowCount: 1,
          extraCount: 1,
        },
        structure: { sectors: 2, lines: 3, customers: 4 },
        accounts: { active: 4, completed: 0 },
        // BR-18 disbursement postings: A = 2 × 10,000 + 2,000 + 6,000;
        // I = 2 × 8,500 + 1,700 + 5,100; P = A − I.
        totals: {
          accountAmount: '28000.00',
          invested: '23800.00',
          profit: '4200.00',
        },
        // Ordered by sector code, which is random here.
        sectors: expect.arrayContaining([
          {
            sectorId: w.north,
            code: expect.any(String),
            name: 'Sector',
            lineCount: 2,
            expected: '1100.00',
            collected: '1050.00',
            shortfall: '100.00',
            surplus: '50.00',
            lowCount: 1,
            extraCount: 1,
            linesToClose: 2,
            linesClosed: 0,
            linesTallied: 0,
            tally: 'OPEN',
          },
          {
            sectorId: w.south.id,
            code: w.south.code,
            name: 'South',
            lineCount: 1,
            expected: '300.00',
            collected: '300.00',
            shortfall: '0.00',
            surplus: '0.00',
            lowCount: 0,
            extraCount: 0,
            linesToClose: 1,
            linesClosed: 0,
            linesTallied: 0,
            tally: 'OPEN',
          },
        ]),
        tally: { collecting: 2, tallied: 0, withExtra: 1, withLow: 1 },
      });
      expect(view.sectors).toHaveLength(2);
      expect(view.sectors!.map((sector) => sector.code)).toEqual(
        view
          .sectors!.map((sector) => sector.code)
          .sort((a, b) => a.localeCompare(b)),
      );

      // §23: the business is the sum of its sectors, each the sum of its lines.
      const lines = (await w.operations.view(w.admin, MONDAY, MONDAY_EVENING))
        .lines!;
      for (const sector of view.sectors!) {
        const own = lines.filter((line) => line.sectorId === sector.sectorId);
        const sum = (pick: (line: (typeof own)[number]) => string) =>
          own.reduce((total, line) => total.plus(pick(line)), toMoney('0'));
        expect(sector.expected).toBe(sum((line) => line.expected).toFixed(2));
        expect(sector.collected).toBe(sum((line) => line.collected).toFixed(2));
      }
      const business = view.sectors!.reduce(
        (total, sector) => total.plus(sector.collected),
        toMoney('0'),
      );
      expect(business.toFixed(2)).toBe(view.today!.collected);
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('agrees with the Admin operational dashboard (US-082) for the same date', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await monday(tx);
      const overview = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);
      const operations = await w.operations.view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(overview.today).toEqual({
        expected: operations.today!.expected,
        collected: operations.today!.collected,
        pending: operations.today!.pending,
        extra: operations.today!.extra,
        lowCount: operations.today!.lowCount,
        extraCount: operations.today!.extraCount,
      });
      expect(overview.accounts).toEqual({
        active: operations.accounts!.active,
        completed: operations.accounts!.completed,
      });
      expect(overview.totals).toMatchObject(operations.investment!);
      expect(
        overview.sectors!.map((sector) => [
          sector.sectorId,
          sector.expected,
          sector.collected,
          sector.lineCount,
        ]),
      ).toEqual(
        operations.sectors!.map((sector) => [
          sector.sectorId,
          sector.expected,
          sector.collected,
          sector.lineCount,
        ]),
      );
    });
  });

  it("rolls a sector's tally up from its lines' day closes: all tallied, all closed, or open (§19)", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      // North's Line A has money due and collected; nothing is due on Line B
      // or on South's Line C, so closing those tallies at once (BR-16).
      const a1 = await w.account(w.line.id, w.north, '500');
      await w.collect(w.junior, a1.id, '500');

      const close = (lineId: string) =>
        w.dayCloses.close(w.admin, lineId, MONDAY, true, MONDAY_EVENING);
      await close(w.lineC.id);
      await close(w.otherLine.id);

      const tally = async () => {
        const view = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);
        return {
          sectors: Object.fromEntries(
            view.sectors!.map((sector) => [
              sector.sectorId === w.north ? 'north' : 'south',
              [sector.tally, sector.linesClosed, sector.linesTallied],
            ]),
          ),
          summary: view.tally,
        };
      };

      expect(await tally()).toEqual({
        sectors: { north: ['OPEN', 1, 1], south: ['TALLIED', 1, 1] },
        summary: { collecting: 2, tallied: 1, withExtra: 0, withLow: 0 },
      });

      // Line A closes with ₹500 collected and no cash handed over: CLOSED,
      // not TALLIED, so North is closed but has not tallied.
      await close(w.line.id);
      expect(await tally()).toEqual({
        sectors: { north: ['CLOSED', 2, 1], south: ['TALLIED', 1, 1] },
        summary: { collecting: 2, tallied: 1, withExtra: 0, withLow: 0 },
      });

      // Sunday: nothing is due, so no sector is collecting.
      const sunday = await w.overview.view(
        w.admin,
        parseCalendarDate('2026-01-04'),
        MONDAY_EVENING,
      );
      expect(sunday.day).toEqual({ kind: 'SUNDAY' });
      expect(sunday.sectors!.map((sector) => sector.tally)).toEqual([
        'NO_COLLECTIONS',
        'NO_COLLECTIONS',
      ]);
      expect(sunday.tally).toEqual({
        collecting: 0,
        tallied: 0,
        withExtra: 0,
        withLow: 0,
      });
    });
  });

  it('counts active and completed accounts apart, and active sectors and lines only', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await monday(tx);
      // Paid off in one visit: ₹2,000 against a ₹2,000 account completes it.
      const paidOff = await w.account(w.lineC.id, w.south.id, '100');
      await w.collect(w.juniorC, paidOff.id, '2000');
      expect(
        (await tx.accountLoan.findUniqueOrThrow({ where: { id: paidOff.id } }))
          .status,
      ).toBe('COMPLETED');
      await tx.line.create({
        data: {
          organizationId: w.organizationId,
          sectorId: w.south.id,
          code: `L-${randomUUID()}`,
          name: 'Retired line',
          isActive: false,
        },
      });

      const view = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.accounts).toEqual({ active: 4, completed: 1 });
      expect(view.structure).toEqual({ sectors: 2, lines: 3, customers: 5 });
      // The completed account was disbursed, so it is in the ledger's totals.
      expect(view.totals).toEqual({
        accountAmount: '30000.00',
        invested: '25500.00',
        profit: '4500.00',
      });
    });
  });

  it('S-07: a group that cannot be read is null, never zero — the rest still arrive', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await monday(tx);
      const logger = { error: vi.fn() };
      const service = (model: string, method: string) =>
        new BusinessOverviewService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        );

      const noLedger = await service('ledgerEntry', 'aggregate').view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(noLedger).toMatchObject({
        totals: null,
        today: { expected: '1400.00', collected: '1350.00' },
        accounts: { active: 4, completed: 0 },
        structure: { sectors: 2, lines: 3, customers: 4 },
        setupNeeded: false,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: totals',
      );

      // The lines fail: today's money, the sectors and the tally are unknown.
      const noLines = await service('line', 'findMany').view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(noLines).toMatchObject({
        today: null,
        sectors: null,
        tally: null,
        structure: { sectors: 2, lines: 3, customers: 4 },
        totals: { accountAmount: '28000.00' },
      });

      // The structure fails: whether setup is needed is unknown, not "yes".
      const noSectors = await service('sector', 'count').view(
        w.admin,
        MONDAY,
        MONDAY_EVENING,
      );
      expect(noSectors).toMatchObject({
        structure: null,
        setupNeeded: null,
        today: { expected: '1400.00' },
      });
    });
  });

  it('an organization with no sector or line yet is the setup state; a future date is refused', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const bare = await tx.organization.create({
        data: { name: 'Rasi Empty', timezone: 'Asia/Kolkata', currency: 'INR' },
      });
      const admin = await createStaff(tx, bare.id, 'ADMIN');
      const context: RequestContext = {
        requestId: 'req_test',
        userId: admin.userId,
        staffProfileId: admin.id,
        organizationId: bare.id,
        role: 'SUPER_ADMIN',
        currentLineId: null,
      };
      const view = await w.overview.view(context, MONDAY, MONDAY_EVENING);
      expect(view).toMatchObject({
        setupNeeded: true,
        structure: { sectors: 0, lines: 0, customers: 0 },
        accounts: { active: 0, completed: 0 },
        totals: { accountAmount: '0.00', invested: '0.00', profit: '0.00' },
        sectors: [],
        tally: { collecting: 0, tallied: 0, withExtra: 0, withLow: 0 },
      });

      await expect(
        w.overview.view(
          w.admin,
          parseCalendarDate('2026-01-06'),
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });
    });
  });

  it("counts only the caller's organization", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await monday(tx);
      const other = await createLine(tx);
      await tx.customer.create({
        data: {
          organizationId: other.organization.id,
          customerCode: `C-${randomUUID()}`,
          name: 'Elsewhere',
          mobile: '+919800000002',
          address: '1 Other Street',
          sectorId: other.sector.id,
          lineId: other.line.id,
        },
      });
      const view = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.structure).toEqual({ sectors: 2, lines: 3, customers: 4 });
      expect(view.sectors).toHaveLength(2);
    });
  });
});
