import { Injectable } from '@nestjs/common';
import type {
  LineToday,
  SectorComparison,
  SectorComparisonRow,
} from '@repo/contracts';
import { type CalendarDate, toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  businessDay,
  figureOrNull,
  readComparedSectors,
  readDisbursedTotals,
  readDisbursedTotalsBySector,
  readHolidays,
  readLines,
  readStructure,
  readStructureBySector,
  refuseFutureDate,
  sectorDay,
  sumLines,
  tallySummary,
} from './business-figures.js';

/**
 * M11 — the sector comparison (US-081, PDF §18, §19): every sector side by
 * side for one business date — its lines and customers, its account amount,
 * invested and profit, and its day's money and tally — with how many sectors
 * tallied, had extra and had low collection.
 *
 * **One date, not a range.** §19's tally is a day's state, so the comparison
 * is read for a single business date like S-07; nothing is summed over days.
 * The structure and the ledger amounts are as of now, as on S-07.
 *
 * Every figure comes from `business-figures.ts`: a sector's day is exactly
 * US-080's sector row, and the business row is S-07's own reads, so the
 * sectors add up to the business to the paisa and the two screens agree.
 *
 * Decided for US-081:
 *
 * - **Which sectors:** every active one, and an inactive one that still has
 *   lines. A sector with no line that day shows zeros and NO_COLLECTIONS.
 * - **Customers and amounts** belong to the sector of the customer's current
 *   line (`accountScope`); the day's money to the line each collection was
 *   recorded under (BR-15).
 * - **Each group is read on its own** (S-07): one that fails is `null` on
 *   every row and business-wide, never `0`.
 */
@Injectable()
export class SectorComparisonService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    businessDate: CalendarDate | undefined,
    now: Date = new Date(),
  ): Promise<SectorComparison> {
    const date = businessDate ?? toBusinessDate(now);
    refuseFutureDate(
      date,
      now,
      'The sector comparison shows today or an earlier day',
    );
    const tx = this.database.client;
    const figure = <T>(group: string, read: () => Promise<T>) =>
      figureOrNull(this.logger, context, group, read);

    const holidays = await figure('holidays', () =>
      readHolidays(tx, context, date),
    );
    const lines =
      holidays === null
        ? null
        : await figure('lines', () => readLines(tx, context, date, holidays));
    const sectors = await figure('sectors', () =>
      readComparedSectors(tx, context),
    );
    const structure = await figure('structure', () =>
      readStructure(tx, context),
    );
    const structureBySector = await figure('sector structure', () =>
      readStructureBySector(tx, context),
    );
    const totals = await figure('totals', () =>
      readDisbursedTotals(tx, context),
    );
    const totalsBySector = await figure('sector totals', () =>
      readDisbursedTotalsBySector(tx, context),
    );

    const rows =
      sectors === null
        ? null
        : sectors.map((sector): SectorComparisonRow => ({
            sectorId: sector.id,
            code: sector.code,
            name: sector.name,
            isActive: sector.isActive,
            structure:
              structureBySector === null
                ? null
                : (structureBySector.get(sector.id) ?? {
                    lines: 0,
                    customers: 0,
                  }),
            totals:
              totalsBySector === null
                ? null
                : (totalsBySector.get(sector.id) ?? {
                    accountAmount: '0.00',
                    invested: '0.00',
                    profit: '0.00',
                  }),
            today:
              lines === null
                ? null
                : sectorDay(
                    lines.filter((line) => line.sectorId === sector.id),
                  ),
          }));

    const days =
      rows === null || lines === null ? null : rows.map((row) => row.today!);
    return {
      businessDate: date,
      day: businessDay(date, holidays),
      generatedAt: now.toISOString(),
      setupNeeded: structure === null ? null : structure.setupNeeded,
      sectors: rows,
      business: {
        structure:
          structure === null
            ? null
            : {
                sectors: structure.sectors,
                lines: structure.lines,
                customers: structure.customers,
              },
        totals,
        today: lines === null ? null : businessToday(lines),
      },
      tally: days === null ? null : tallySummary(days),
    };
  }
}

function businessToday(
  lines: LineToday[],
): NonNullable<SectorComparison['business']['today']> {
  const sum = sumLines(lines);
  return {
    expected: sum.expected,
    collected: sum.collected,
    shortfall: sum.pending,
    surplus: sum.extra,
    lowCount: sum.lowCount,
    extraCount: sum.extraCount,
    linesToClose: sum.linesToClose,
    linesClosed: sum.linesClosed,
    linesTallied: sum.linesTallied,
  };
}
