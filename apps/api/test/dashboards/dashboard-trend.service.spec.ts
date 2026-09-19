import type { PrismaClient } from '@repo/db';
import { parseCalendarDate, toMoney } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';

import { lineDayFigures } from '../../src/cash/line-day-figures.js';
import { DashboardTrendService } from '../../src/dashboards/dashboard-trend.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { at } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { businessMonday, failingClient } from './business-world.js';

/**
 * The dashboards' trend (M11; S-07, S-19, S-20) against real rows, rolled
 * back — it reads collections, which reject DELETE, so this tier proves it.
 *
 * `businessMonday`: disbursed Saturday 3 January 2026, first slots Monday 5.
 * Line A (North) expects 500 + 500 and collects 500 + 400; Line B (North)
 * expects 100 and collects 150; Line C (South) expects and collects 300.
 */
describe('DashboardTrendService', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TUESDAY = parseCalendarDate('2026-01-06');
  const TUESDAY_MORNING = at('2026-01-06', '10:00:00');

  it('worked example: every line summed per working day, Sunday left out, to the paisa', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const trend = await w.trend.view(
        w.admin,
        { date: TUESDAY, days: 3 },
        TUESDAY_MORNING,
      );
      expect(trend).toMatchObject({
        businessDate: '2026-01-06',
        days: 3,
        lineCount: 3,
      });
      expect(trend.points).toEqual([
        { businessDate: '2026-01-03', expected: '0.00', collected: '0.00' },
        {
          businessDate: '2026-01-05',
          expected: '1400.00',
          collected: '1350.00',
        },
        { businessDate: '2026-01-06', expected: '1400.00', collected: '0.00' },
      ]);
    });
  });

  it("agrees with the Admin dashboard's day and with each line's day close", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const monday = parseCalendarDate('2026-01-05');
      const trend = await w.trend.view(
        w.admin,
        { date: monday, days: 2 },
        TUESDAY_MORNING,
      );
      const operations = await w.operations.view(
        w.admin,
        monday,
        TUESDAY_MORNING,
      );
      const point = trend.points!.at(-1)!;
      expect(point).toMatchObject({
        expected: operations.today!.expected,
        collected: operations.today!.collected,
      });

      const lines = await lineDayFigures(
        tx,
        [w.line.id, w.otherLine.id, w.lineC.id],
        monday,
      );
      const collected = [...lines.values()].reduce(
        (sum, line) => sum.plus(line.collected),
        toMoney('0'),
      );
      expect(point.collected).toBe(collected.toFixed(2));
    });
  });

  it('skips a business-wide holiday, and a sector holiday only when every sector in view is off', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const friday = new Date('2026-01-02');
      await tx.holiday.create({
        data: {
          organizationId: w.organizationId,
          sectorId: w.south.id,
          date: friday,
          name: 'South festival',
        },
      });
      const dates = async (who: RequestContext, lineId?: string) =>
        (
          await w.trend.view(
            who,
            { date: TUESDAY, days: 4, lineId },
            TUESDAY_MORNING,
          )
        ).points!.map((point) => point.businessDate);

      // North still collects on Friday, so the business keeps the date.
      expect(await dates(w.admin)).toEqual([
        '2026-01-02',
        '2026-01-03',
        '2026-01-05',
        '2026-01-06',
      ]);
      // Line C alone is South, which is off.
      expect(await dates(w.admin, w.lineC.id)).toEqual([
        '2026-01-01',
        '2026-01-03',
        '2026-01-05',
        '2026-01-06',
      ]);

      await tx.holiday.create({
        data: {
          organizationId: w.organizationId,
          sectorId: null,
          date: new Date('2026-01-01'),
          name: 'New Year',
        },
      });
      expect(await dates(w.admin)).toEqual([
        '2026-01-02',
        '2026-01-03',
        '2026-01-05',
        '2026-01-06',
      ]);
      expect(await dates(w.admin, w.lineC.id)).toEqual([
        '2025-12-31',
        '2026-01-03',
        '2026-01-05',
        '2026-01-06',
      ]);
    });
  });

  it('a Senior sees only their own line: another line is not found, and no line means no points', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const own = await w.trend.view(
        w.senior,
        { date: TUESDAY, days: 2 },
        TUESDAY_MORNING,
      );
      expect(own.lineCount).toBe(1);
      expect(own.points).toEqual([
        {
          businessDate: '2026-01-05',
          expected: '1000.00',
          collected: '900.00',
        },
        { businessDate: '2026-01-06', expected: '1000.00', collected: '0.00' },
      ]);

      await expect(
        w.trend.view(
          w.senior,
          { date: TUESDAY, days: 2, lineId: w.lineC.id },
          TUESDAY_MORNING,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND' });

      const unassigned = await w.trend.view(
        { ...w.senior, currentLineId: null },
        { date: TUESDAY, days: 2 },
        TUESDAY_MORNING,
      );
      expect(unassigned).toMatchObject({ lineCount: 0, points: [] });
    });
  });

  it('points that cannot be read are null, never zeros', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      const logger = { error: vi.fn() };
      const service = new DashboardTrendService(
        new Database(failingClient(tx, 'collection', 'groupBy')),
        logger as unknown as PinoLogger,
      );
      const trend = await service.view(
        w.admin,
        { date: TUESDAY, days: 3 },
        TUESDAY_MORNING,
      );
      expect(trend).toMatchObject({ lineCount: 3, points: null });
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses a date after today', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      await expect(
        w.trend.view(
          w.admin,
          { date: parseCalendarDate('2026-01-07'), days: 3 },
          TUESDAY_MORNING,
        ),
      ).rejects.toMatchObject({ code: 'DATE_IN_FUTURE' });
    });
  });

  it("never counts another organization's lines", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await businessMonday(tx);
      await businessMonday(tx);
      const trend = await w.trend.view(
        w.admin,
        { date: TUESDAY, days: 2 },
        TUESDAY_MORNING,
      );
      expect(trend.lineCount).toBe(3);
      expect(trend.points![0]).toMatchObject({
        expected: '1400.00',
        collected: '1350.00',
      });
    });
  });
});
