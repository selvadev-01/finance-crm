import { Injectable } from '@nestjs/common';
import type { BusinessOverview, LineToday } from '@repo/contracts';
import { type CalendarDate, toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  businessDay,
  figureOrNull,
  readAccountCounts,
  readDisbursedTotals,
  readHolidays,
  readLines,
  readStructure,
  refuseFutureDate,
  sectorRows,
  sumLines,
  tallySummary,
} from './business-figures.js';

/**
 * M11 — the Super Admin business overview (US-080, S-07, PDF §17, §19).
 *
 * §17's thirteen figures, rolled up `Customer → Line → Sector → Business`
 * (§23). The day's money, the sector rows, the tally, the account counts and
 * the ledger totals come from `business-figures.ts`, the same readers as the
 * sector comparison (US-081) and the Admin operational dashboard (US-082), so
 * the screens agree to the paisa for the same date.
 *
 * **Each group is read on its own** (S-07): one that fails is logged and
 * returned as `null`; the sectors and the §19 tally are built from the lines
 * and are `null` whenever the lines are.
 *
 * Decided for US-080 where the PDF names a figure without defining it:
 *
 * - **Sectors** and **lines** count the active ones; **customers** counts
 *   every customer not deleted — all as of now.
 * - **Total account amount**, **invested** and **profit** are the ledger's
 *   DISBURSEMENT postings (BR-18): `A` debited to the receivable, `I` and `P`
 *   credited — every account ever disbursed.
 * - **Pending**, **extra** and **low** are US-082's: BR-16 per line, summed;
 *   `low` is the count of LOW originals (BR-08).
 * - **Sector tally** (§19) rolls up the `day_close` states of the sector's
 *   active lines with collections due: all TALLIED is TALLIED, all closed is
 *   CLOSED, otherwise OPEN; none due is NO_COLLECTIONS. A sector "had extra"
 *   when its per-line surplus is above zero, and "had low collection" when its
 *   per-line shortfall is.
 */
@Injectable()
export class BusinessOverviewService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    businessDate: CalendarDate | undefined,
    now: Date = new Date(),
  ): Promise<BusinessOverview> {
    const date = businessDate ?? toBusinessDate(now);
    refuseFutureDate(date, now, 'The overview shows today or an earlier day');
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
    const structure = await figure('structure', () =>
      readStructure(tx, context),
    );
    const accounts = await figure('accounts', async () => {
      const { active, completed } = await readAccountCounts(tx, context);
      return { active, completed };
    });
    const totals = await figure('totals', () =>
      readDisbursedTotals(tx, context),
    );

    const sectors = lines === null ? null : sectorRows(lines);
    return {
      businessDate: date,
      day: businessDay(date, holidays),
      generatedAt: now.toISOString(),
      setupNeeded: structure === null ? null : structure.setupNeeded,
      today: lines === null ? null : todayTotals(lines),
      structure:
        structure === null
          ? null
          : {
              sectors: structure.sectors,
              lines: structure.lines,
              customers: structure.customers,
            },
      accounts,
      totals,
      sectors,
      tally: sectors === null ? null : tallySummary(sectors),
    };
  }
}

function todayTotals(
  lines: LineToday[],
): NonNullable<BusinessOverview['today']> {
  const sum = sumLines(lines);
  return {
    expected: sum.expected,
    collected: sum.collected,
    pending: sum.pending,
    extra: sum.extra,
    lowCount: sum.lowCount,
    extraCount: sum.extraCount,
  };
}
