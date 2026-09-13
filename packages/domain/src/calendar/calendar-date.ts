/**
 * A calendar date with no time component — `"2026-01-05"`.
 *
 * Deliberately not a `Date`. A `Date` is an instant, and every conversion
 * between an instant and a calendar date is a place a day can silently move
 * (M06). The only instant → date conversion in the system is `toBusinessDate`.
 *
 * The brand means a `CalendarDate` can only come from `parseCalendarDate`,
 * `fromUtcMidnight` or this module's own arithmetic, so an unvalidated string
 * cannot reach working-day arithmetic. ISO strings order lexically, so `<` and
 * `>` compare them correctly, and they work as `Set` keys.
 */
export type CalendarDate = string & { readonly __brand: "CalendarDate" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Parses `YYYY-MM-DD`, rejecting dates that do not exist (`2026-02-29`). */
export function parseCalendarDate(value: string): CalendarDate {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new RangeError(
      `Not a calendar date (expected YYYY-MM-DD): "${value}"`,
    );
  }
  const [, year, month, day] = match;
  const epochMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
  // Date.UTC rolls 2026-02-29 over to 2026-03-01; a round trip catches it.
  // It also maps years 0–99 onto 1900–1999, which the round trip rejects too.
  if (formatUtc(new Date(epochMs)) !== value) {
    throw new RangeError(`Not a real calendar date: "${value}"`);
  }
  return value as CalendarDate;
}

export function isCalendarDate(value: string): value is CalendarDate {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a PostgreSQL `date` column. Prisma returns `@db.Date` as a `Date` at
 * 00:00 UTC; anything else is a `timestamptz` instant, which must go through
 * `toBusinessDate` instead — so it is refused rather than truncated (BR-12).
 */
export function fromUtcMidnight(value: Date): CalendarDate {
  const epochMs = value.getTime();
  if (Number.isNaN(epochMs)) {
    throw new RangeError("Invalid Date");
  }
  if (epochMs % MS_PER_DAY !== 0) {
    throw new RangeError(
      `Expected a date at 00:00 UTC, got the instant ${value.toISOString()}. ` +
        "Convert instants with toBusinessDate.",
    );
  }
  return formatUtc(value) as CalendarDate;
}

/** Writes a PostgreSQL `date` column: the date at 00:00 UTC. */
export function toUtcMidnight(date: CalendarDate): Date {
  return new Date(toEpochDay(date) * MS_PER_DAY);
}

/** Days since 1970-01-01. Integer arithmetic on this is timezone-free. */
export function toEpochDay(date: CalendarDate): number {
  return Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;
}

export function fromEpochDay(epochDay: number): CalendarDate {
  return formatUtc(new Date(epochDay * MS_PER_DAY)) as CalendarDate;
}

export function addCalendarDays(
  date: CalendarDate,
  days: number,
): CalendarDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** `0` = Sunday … `6` = Saturday. */
export function dayOfWeek(date: CalendarDate): number {
  // 1970-01-01 was a Thursday (4). The double modulo keeps pre-1970 dates positive.
  return (((toEpochDay(date) + 4) % 7) + 7) % 7;
}

function formatUtc(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
