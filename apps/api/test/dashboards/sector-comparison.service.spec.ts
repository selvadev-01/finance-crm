import type { SectorComparison } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { SectorComparisonService } from '../../src/dashboards/sector-comparison.service.js';
import { Database } from '../../src/platform/database/database.js';
import { at, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { createLine } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';
import {
  businessMonday,
  businessWorld,
  failingClient,
} from './business-world.js';

/**
 * The sector comparison (M11, US-081, PDF §18, §19) against real rows, rolled
 * back — it reads collections, closes and ledger postings, which reject
 * DELETE. The world is `business-world.ts`: North holds Line A (two accounts
 * at ₹500 a day) and Line B (one at ₹100); South holds Line C (one at ₹300).
 * Every account is A = 20 × D, I = 17 × D.
 */
describe('SectorComparisonService (US-081)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const MONDAY_EVENING = at('2026-01-05', '20:00:00');
  type Row = NonNullable<SectorComparison['sectors']>[number];

  /** Σ over the rows of one money figure, exactly. */
  function sumRows(view: SectorComparison, pick: (row: Row) => string): string {
    return view
      .sectors!.reduce((total, row) => total.plus(pick(row)), toMoney('0'))
      .toFixed(2);
  }

  it('Scenario: Monday — each sector’s lines, customers, amounts and day, and §19’s summary', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const view = await w.sectors.view(
        w.superAdmin,
        undefined,
        MONDAY_EVENING,
      );

      const north = view.sectors!.find((row) => row.sectorId === w.north)!;
      const south = view.sectors!.find((row) => row.sectorId === w.south.id)!;
      expect(view.sectors).toHaveLength(2);
      expect(north).toMatchObject({
        name: 'Sector',
        isActive: true,
        structure: { lines: 2, customers: 3 },
        // BR-18: A = 10,000 + 10,000 + 2,000; I = 8,500 + 8,500 + 1,700.
        totals: {
          accountAmount: '22000.00',
          invested: '18700.00',
          profit: '3300.00',
        },
        // Line A is ₹100 short and Line B ₹50 over: BR-16 per line.
        today: {
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
      });
      expect(south).toEqual({
        sectorId: w.south.id,
        code: w.south.code,
        name: 'South',
        isActive: true,
        structure: { lines: 1, customers: 1 },
        totals: {
          accountAmount: '6000.00',
          invested: '5100.00',
          profit: '900.00',
        },
        today: {
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
      });
      expect(view).toMatchObject({
        businessDate: '2026-01-05',
        day: { kind: 'WORKING' },
        generatedAt: MONDAY_EVENING.toISOString(),
        setupNeeded: false,
        tally: { collecting: 2, tallied: 0, withExtra: 1, withLow: 1 },
      });
      // By code, as S-07 lists them.
      expect(view.sectors!.map((row) => row.code)).toEqual(
        view.sectors!.map((row) => row.code).sort((a, b) => a.localeCompare(b)),
      );
      expect(w.logger.error).not.toHaveBeenCalled();
    });
  });

  it('the sectors add up to the business to the paisa (§23)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      // An uneven account, so the sums are not round: A = 20 × 333.33.
      await w.account(w.lineC.id, w.south.id, '333.33');
      const view = await w.sectors.view(w.admin, MONDAY, MONDAY_EVENING);
      const business = view.business;

      expect(business.totals).toEqual({
        accountAmount: '34666.60',
        invested: '29466.61',
        profit: '5199.99',
      });
      expect({
        accountAmount: sumRows(view, (row) => row.totals!.accountAmount),
        invested: sumRows(view, (row) => row.totals!.invested),
        profit: sumRows(view, (row) => row.totals!.profit),
      }).toEqual(business.totals);

      for (const key of [
        'expected',
        'collected',
        'shortfall',
        'surplus',
      ] as const) {
        expect(sumRows(view, (row) => row.today![key])).toBe(
          business.today![key],
        );
      }
      const count = (pick: (row: Row) => number) =>
        view.sectors!.reduce((total, row) => total + pick(row), 0);
      expect(count((row) => row.today!.lowCount)).toBe(
        business.today!.lowCount,
      );
      expect(count((row) => row.today!.linesToClose)).toBe(
        business.today!.linesToClose,
      );
      expect(count((row) => row.structure!.lines)).toBe(
        business.structure!.lines,
      );
      expect(count((row) => row.structure!.customers)).toBe(
        business.structure!.customers,
      );
      expect(business.structure).toEqual({
        sectors: 2,
        lines: 3,
        customers: 5,
      });
    });
  });

  it('for one day, equals the business overview (US-080) figure for figure', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      // A closed line, so the tally has something to agree on.
      await w.dayCloses.close(
        w.admin,
        w.lineC.id,
        MONDAY,
        true,
        MONDAY_EVENING,
      );
      const overview = await w.overview.view(w.admin, MONDAY, MONDAY_EVENING);
      const view = await w.sectors.view(w.admin, MONDAY, MONDAY_EVENING);

      expect(view.sectors!.map((row) => row.sectorId)).toEqual(
        overview.sectors!.map((sector) => sector.sectorId),
      );
      for (const sector of overview.sectors!) {
        const { sectorId, code, name, lineCount, ...day } = sector;
        const row = view.sectors!.find((each) => each.sectorId === sectorId)!;
        expect([row.code, row.name]).toEqual([code, name]);
        expect(row.today).toEqual(day);
        expect(row.structure!.lines).toBe(lineCount);
      }
      expect(view.tally).toEqual(overview.tally);
      expect(view.business.totals).toEqual(overview.totals);
      expect(view.business.structure).toEqual(overview.structure);
      expect(view.business.today).toMatchObject({
        expected: overview.today!.expected,
        collected: overview.today!.collected,
        shortfall: overview.today!.pending,
        surplus: overview.today!.extra,
        lowCount: overview.today!.lowCount,
        extraCount: overview.today!.extraCount,
      });
      expect(view.setupNeeded).toBe(overview.setupNeeded);
    });
  });

  it('a transferred customer takes their accounts to the new sector; the day’s collections stay where they were recorded (BR-15)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const moving = await w.account(w.otherLine.id, w.north, '100');
      await w.collect(w.juniorB, moving.id, '150');
      await tx.customer.update({
        where: { id: moving.customerId },
        data: { lineId: w.lineC.id, sectorId: w.south.id },
      });

      const view = await w.sectors.view(w.admin, MONDAY, MONDAY_EVENING);
      const row = (sectorId: string) =>
        view.sectors!.find((each) => each.sectorId === sectorId)!;
      expect(row(w.north).structure).toEqual({ lines: 2, customers: 0 });
      expect(row(w.north).totals!.accountAmount).toBe('0.00');
      expect(row(w.north).today!.collected).toBe('150.00');
      expect(row(w.south.id).structure).toEqual({ lines: 1, customers: 1 });
      expect(row(w.south.id).totals).toEqual({
        accountAmount: '2000.00',
        invested: '1700.00',
        profit: '300.00',
      });
      expect(row(w.south.id).today!.collected).toBe('0.00');
    });
  });

  it('lists every active sector, and an inactive one only while it has lines', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessWorld(tx);
      const empty = await tx.sector.create({
        data: {
          organizationId: w.organizationId,
          code: `S-${randomUUID()}`,
          name: 'Empty',
        },
      });
      const retired = await tx.sector.create({
        data: {
          organizationId: w.organizationId,
          code: `S-${randomUUID()}`,
          name: 'Retired',
          isActive: false,
        },
      });
      await tx.line.create({
        data: {
          organizationId: w.organizationId,
          sectorId: retired.id,
          code: `L-${randomUUID()}`,
          name: 'Retired line',
          isActive: false,
        },
      });
      await tx.sector.create({
        data: {
          organizationId: w.organizationId,
          code: `S-${randomUUID()}`,
          name: 'Never used',
          isActive: false,
        },
      });

      const view = await w.sectors.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.sectors!.map((row) => row.name).sort()).toEqual([
        'Empty',
        'Retired',
        'Sector',
        'South',
      ]);
      const nothing = {
        structure: { lines: 0, customers: 0 },
        totals: { accountAmount: '0.00', invested: '0.00', profit: '0.00' },
        today: expect.objectContaining({
          expected: '0.00',
          collected: '0.00',
          linesToClose: 0,
          tally: 'NO_COLLECTIONS',
        }),
      };
      expect(view.sectors!.find((row) => row.sectorId === empty.id)).toEqual({
        sectorId: empty.id,
        code: empty.code,
        name: 'Empty',
        isActive: true,
        ...nothing,
      });
      expect(
        view.sectors!.find((row) => row.sectorId === retired.id),
      ).toMatchObject({ isActive: false, ...nothing });
      // Nothing was collected, so no sector was collecting short or over.
      // Empty and Retired have no line collecting, so only two sectors count.
      expect(view.tally).toEqual({
        collecting: 2,
        tallied: 0,
        withExtra: 0,
        withLow: 0,
      });
      expect(view.business.structure).toMatchObject({ sectors: 3, lines: 3 });

      // Sunday: nothing is due anywhere.
      const sunday = await w.sectors.view(
        w.admin,
        parseCalendarDate('2026-01-04'),
        MONDAY_EVENING,
      );
      expect(sunday.day).toEqual({ kind: 'SUNDAY' });
      expect(new Set(sunday.sectors!.map((row) => row.today!.tally))).toEqual(
        new Set(['NO_COLLECTIONS']),
      );
      expect(sunday.tally).toMatchObject({ collecting: 0 });
    });
  });

  it('S-07: a group that cannot be read is null on every row and business-wide, never zero', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const logger = { error: vi.fn() };
      const service = (model: string, method: string) =>
        new SectorComparisonService(
          new Database(failingClient(tx, model, method)),
          logger as unknown as PinoLogger,
        );
      const view = (model: string, method: string) =>
        service(model, method).view(w.admin, MONDAY, MONDAY_EVENING);

      // The per-sector ledger read fails; the business total still arrives.
      const noSectorTotals = await view('ledgerEntry', 'findMany');
      expect(noSectorTotals.sectors!.map((row) => row.totals)).toEqual([
        null,
        null,
      ]);
      expect(noSectorTotals.sectors![0]!.structure).not.toBeNull();
      expect(noSectorTotals.business.totals).toEqual({
        accountAmount: '28000.00',
        invested: '23800.00',
        profit: '4200.00',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req_test' }),
        'Dashboard figures unavailable: sector totals',
      );

      // The business-wide ledger read fails; each sector's still arrives.
      const noTotals = await view('ledgerEntry', 'aggregate');
      expect(noTotals.business.totals).toBeNull();
      expect(sumRows(noTotals, (row) => row.totals!.accountAmount)).toBe(
        '28000.00',
      );

      // Customers per line fail: each sector's structure is unknown.
      const noCustomers = await view('customer', 'groupBy');
      expect(noCustomers.sectors!.every((row) => row.structure === null)).toBe(
        true,
      );
      expect(noCustomers.business.structure).toEqual({
        sectors: 2,
        lines: 3,
        customers: 4,
      });

      // The lines fail: the day's money, the tally, and everything rolled up
      // through a line are unknown; the sectors are still listed.
      const noLines = await view('line', 'findMany');
      expect(noLines).toMatchObject({
        tally: null,
        business: { today: null, totals: { accountAmount: '28000.00' } },
      });
      expect(noLines.sectors).toHaveLength(2);
      for (const row of noLines.sectors!) {
        expect(row).toMatchObject({
          today: null,
          structure: null,
          totals: null,
        });
      }

      // The sectors fail: no rows, and no tally, but the business arrives.
      const noSectors = await view('sector', 'findMany');
      expect(noSectors).toMatchObject({
        sectors: null,
        tally: null,
        business: { today: { collected: '1350.00' } },
      });
    });
  });

  it('refuses a future date, and counts only the caller’s organization', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      await expect(
        w.sectors.view(
          w.admin,
          parseCalendarDate('2026-01-06'),
          MONDAY_EVENING,
        ),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE', status: 422 });

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
      const view = await w.sectors.view(w.admin, MONDAY, MONDAY_EVENING);
      expect(view.sectors!.map((row) => row.sectorId).sort()).toEqual(
        [w.north, w.south.id].sort(),
      );
      expect(view.business.structure).toEqual({
        sectors: 2,
        lines: 3,
        customers: 4,
      });
    });
  });
});
