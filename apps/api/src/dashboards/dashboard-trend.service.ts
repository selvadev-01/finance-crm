import { Injectable } from '@nestjs/common';
import type { DashboardTrend, TrendPoint } from '@repo/contracts';
import { type CalendarDate, toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { foundInScope, inScope, lineScope } from '../access/scope.js';
import { lineDailyFigures, lineDayKey } from '../cash/line-day-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  figureOrNull,
  refuseFutureDate,
  workingDates,
  ZERO,
} from './business-figures.js';

export interface TrendQuery {
  date?: CalendarDate | undefined;
  days: number;
  lineId?: string | undefined;
}

/**
 * M11 — expected against collected per working day, the trend on S-07, S-19
 * and S-20. Each day is BR-16's expected and BR-15's collected read through
 * `lineDailyFigures`, the function the day close and the reports fold from,
 * so a point equals the dashboards' own figures for that date to the paisa.
 *
 * **Scope decides whose lines** (M02): an Admin or Super Admin sums every line
 * in the organization, which is the business; a Senior sums their current
 * line; a Senior with no line gets no points. A `lineId` outside scope is
 * `404`, identical to a missing one.
 *
 * **Working days only** (M06): Sundays, business-wide holidays and dates when
 * every sector in view is on holiday are left out, so the chart has no false
 * zero days. Points that could not be read are `null`, never zeros (S-07).
 */
@Injectable()
export class DashboardTrendService {
  constructor(
    private readonly database: Database,
    private readonly logger: PinoLogger,
  ) {}

  async view(
    context: RequestContext,
    query: TrendQuery,
    now: Date = new Date(),
  ): Promise<DashboardTrend> {
    const to = query.date ?? toBusinessDate(now);
    refuseFutureDate(to, now, 'The trend ends today or an earlier day');
    const tx = this.database.client;
    const select = { id: true, sectorId: true, isActive: true } as const;
    const lines =
      query.lineId === undefined
        ? await tx.line.findMany({ where: inScope(lineScope(context)), select })
        : [
            foundInScope(
              await tx.line.findFirst({
                where: inScope(lineScope(context), { id: query.lineId }),
                select,
              }),
              'line',
            ),
          ];

    const points = await figureOrNull(
      this.logger,
      context,
      'trend',
      async (): Promise<TrendPoint[]> => {
        if (lines.length === 0) return [];
        // A sector holiday only empties the day when every sector in view is off.
        const active = lines.filter((line) => line.isActive);
        const sectorIds = [
          ...new Set(
            (active.length > 0 ? active : lines).map((l) => l.sectorId),
          ),
        ];
        const dates = await workingDates(
          tx,
          context,
          sectorIds,
          to,
          query.days,
        );
        if (dates.length === 0) return [];
        const byDay = await lineDailyFigures(
          tx,
          lines.map((line) => line.id),
          dates[0]!,
          dates.at(-1)!,
        );
        return dates.map((businessDate) => {
          let expected = ZERO();
          let collected = ZERO();
          for (const line of lines) {
            const day = byDay.get(lineDayKey(line.id, businessDate));
            if (!day) continue;
            expected = expected.plus(day.expected);
            collected = collected.plus(day.collected);
          }
          return {
            businessDate,
            expected: expected.toFixed(2),
            collected: collected.toFixed(2),
          };
        });
      },
    );

    return {
      businessDate: to,
      generatedAt: now.toISOString(),
      days: query.days,
      lineCount: lines.length,
      points,
    };
  }
}
