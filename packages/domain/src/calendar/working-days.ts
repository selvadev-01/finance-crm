import {
  addCalendarDays,
  type CalendarDate,
  dayOfWeek,
  toEpochDay,
} from "./calendar-date.js";

/**
 * Working-day arithmetic (M06, BR-02, BR-03).
 *
 * A working day — synonymously a collection day — is any date that is not a
 * Sunday and not a declared holiday.
 *
 * `holidays` is the set already resolved for one sector: business-wide rows
 * (`sectorId` null) plus that sector's own. Resolving scope is the caller's
 * job; this module only does arithmetic. Sundays are excluded by rule and are
 * never expected in the set, though one that appears is harmless.
 *
 * **Every function counts from the day after its start date.** The start date
 * is day 0 — for an account, the disbursement date, which is never a
 * collection day (BR-03). So `countWorkingDays(from, to)` counts the half-open
 * range `(from, to]`, and the invariant
 * `countWorkingDays(d, addWorkingDays(d, n, h), h) === n` holds for every `d`.
 */
export type HolidaySet = ReadonlySet<CalendarDate>;

const SUNDAY = 0;

/** BR-02: not a Sunday and not a declared holiday. */
export function isWorkingDay(
  date: CalendarDate,
  holidays: HolidaySet,
): boolean {
  return dayOfWeek(date) !== SUNDAY && !holidays.has(date);
}

/** The first working day strictly after `date`. BR-03: disbursement → first collection. */
export function nextWorkingDay(
  date: CalendarDate,
  holidays: HolidaySet,
): CalendarDate {
  // Terminates: the set is finite, and at most one day in seven is a Sunday.
  let candidate = addCalendarDays(date, 1);
  while (!isWorkingDay(candidate, holidays)) {
    candidate = addCalendarDays(candidate, 1);
  }
  return candidate;
}

/**
 * `date` itself when it is a working day, otherwise the first working day
 * after it. Unlike `nextWorkingDay` this can return its own argument, which is
 * what a weekly or monthly anchor wants: the visit keeps its date unless that
 * date is a Sunday or a holiday (BR-02).
 */
export function workingDayOnOrAfter(
  date: CalendarDate,
  holidays: HolidaySet,
): CalendarDate {
  return isWorkingDay(date, holidays) ? date : nextWorkingDay(date, holidays);
}

/** The `n`-th working day after `date`. `n = 0` returns `date` itself, working or not. */
export function addWorkingDays(
  date: CalendarDate,
  n: number,
  holidays: HolidaySet,
): CalendarDate {
  assertCount(n, "n");
  let current = date;
  for (let i = 0; i < n; i += 1) {
    current = nextWorkingDay(current, holidays);
  }
  return current;
}

/**
 * Working days in `(from, to]` — after `from`, up to and including `to`.
 *
 * Computed in closed form rather than by stepping, so it is an independent
 * check on `addWorkingDays` in the property tests rather than a restatement.
 */
export function countWorkingDays(
  from: CalendarDate,
  to: CalendarDate,
  holidays: HolidaySet,
): number {
  if (to < from) {
    throw new RangeError(
      `countWorkingDays: 'to' (${to}) is before 'from' (${from})`,
    );
  }
  const fromDay = toEpochDay(from);
  const toDay = toEpochDay(to);

  // Epoch days congruent to 3 mod 7 are Sundays (1970-01-04 is epoch day 3).
  const sundays = floorDiv(toDay - 3, 7) - floorDiv(fromDay - 3, 7);

  let holidaysInRange = 0;
  for (const holiday of holidays) {
    // A holiday on a Sunday is already excluded; do not subtract it twice.
    if (holiday > from && holiday <= to && dayOfWeek(holiday) !== SUNDAY) {
      holidaysInRange += 1;
    }
  }

  return toDay - fromDay - sundays - holidaysInRange;
}

/**
 * The `count` consecutive working days after `from`, ascending. BR-04: pass the
 * disbursement date to get an account's collection days.
 */
export function workingDayRange(
  from: CalendarDate,
  count: number,
  holidays: HolidaySet,
): CalendarDate[] {
  assertCount(count, "count");
  const dates: CalendarDate[] = [];
  let current = from;
  for (let i = 0; i < count; i += 1) {
    current = nextWorkingDay(current, holidays);
    dates.push(current);
  }
  return dates;
}

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${value}`,
    );
  }
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}
