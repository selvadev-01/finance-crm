import { MAX_REPORT_DAYS } from '@repo/contracts';
import {
  type CalendarDate,
  daysBetween,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
} from '@repo/domain';

import { DomainError, ValidationError } from '../platform/errors/errors.js';

export interface ReportRange {
  from: CalendarDate;
  to: CalendarDate;
}

/**
 * The date bounds every M12 report takes (report.contract.ts): `to` defaults
 * to today and `from` to the first day of `to`'s month, so no report is ever
 * unbounded. `to` after today is `422 DATE_IN_FUTURE` — a day that has not
 * happened has no pending or extra collection yet. `from` after `to`, or more
 * than {@link MAX_REPORT_DAYS} days inclusive, is `400 INVALID_DATE_RANGE`.
 */
export function reportRange(
  query: { from?: string; to?: string },
  now: Date,
): ReportRange {
  const today = toBusinessDate(now);
  const to = query.to === undefined ? today : parseCalendarDate(query.to);
  if (to > today) {
    throw new DomainError(
      'DATE_IN_FUTURE',
      'A report covers today or earlier days',
      [{ field: 'to', issue: 'is after today' }],
    );
  }
  const from =
    query.from === undefined ? startOfMonth(to) : parseCalendarDate(query.from);
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_REPORT_DAYS) {
    throw new ValidationError(
      'INVALID_DATE_RANGE',
      `Choose a range of up to ${MAX_REPORT_DAYS} days, with "from" on or before "to"`,
      [
        {
          field: span < 0 ? 'from' : 'to',
          issue: `must be 0–${MAX_REPORT_DAYS - 1} days after from`,
        },
      ],
    );
  }
  return { from, to };
}
