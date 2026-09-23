import {
  addCalendarDays,
  addCalendarMonths,
  type CalendarDate,
} from "../calendar/calendar-date.js";
import {
  type HolidaySet,
  nextWorkingDay,
  workingDayOnOrAfter,
  workingDayRange,
} from "../calendar/working-days.js";

/**
 * How often an account's instalments fall due (M05, BR-04).
 *
 * The frequency decides **only where the slots land**, never how much they
 * expect: `D` is the instalment amount and `N` the number of instalments at
 * whatever cadence is chosen, so BR-01's `D × N ≥ A` and BR-07's
 * `min(D, remaining)` are unchanged by this module.
 *
 * `DAILY` is the original behaviour and the default everywhere: one instalment
 * on every working day.
 */
export const COLLECTION_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

export type CollectionFrequency = (typeof COLLECTION_FREQUENCIES)[number];

export function isCollectionFrequency(
  value: string,
): value is CollectionFrequency {
  return (COLLECTION_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * What one instalment is called, and what the term `N` counts — the words the
 * form's labels and BR-01's message use, so the API and the screen cannot
 * describe the same terms differently.
 */
export const FREQUENCY_WORDS: Record<
  CollectionFrequency,
  { instalment: string; term: string; each: string }
> = {
  DAILY: {
    instalment: "Daily amount",
    term: "days",
    each: "every working day",
  },
  WEEKLY: { instalment: "Weekly amount", term: "weeks", each: "once a week" },
  MONTHLY: {
    instalment: "Monthly amount",
    term: "months",
    each: "once a month",
  },
};

/**
 * BR-02 / BR-03 / BR-04: the `count` dates an account's instalments fall due,
 * ascending, the first of them strictly after `from` — day 0 is never a
 * collection day, at any cadence.
 *
 * **Every anchor is measured from `from` itself**, one whole period per
 * instalment: the `i`-th instalment is due `i` periods after day 0. That is
 * what makes the daily rule generalise. A daily account's first slot is the
 * day after disbursement; a weekly account's is a week after it; a monthly
 * account's is a month after it. It is also what makes a regenerated tail
 * (BR-06) right — `after` is the date the money moved, so a weekly customer's
 * next visit is a week later, not tomorrow.
 *
 * - **DAILY** — consecutive working days, exactly as before this module existed.
 * - **WEEKLY / MONTHLY** — calendar steps (7 days, or one calendar month
 *   clamped to the month's last day). An anchor landing on a Sunday or a
 *   declared holiday moves **forward** to the next working day, while the
 *   anchors after it are still measured from `from`, so the cadence never
 *   drifts: a customer collected on Thursdays stays on Thursdays, and a
 *   holiday moves one visit to Friday without moving the rest.
 *
 * > `from` Wed 23 Sep, WEEKLY → Wed 30 Sep, Wed 7 Oct, Wed 14 Oct … and if
 * > 7 Oct is declared a holiday, that one visit is Thu 8 Oct while the next is
 * > still Wed 14 Oct.
 *
 * The dates are strictly increasing: in the pathological case where a run of
 * holidays pushes an anchor past the one after it, the later slot is moved to
 * the next working day instead, so two instalments never share a date.
 */
export function collectionDueDates(
  from: CalendarDate,
  count: number,
  frequency: CollectionFrequency,
  holidays: HolidaySet,
): CalendarDate[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${count}`);
  }
  if (frequency === "DAILY") return workingDayRange(from, count, holidays);

  const dates: CalendarDate[] = [];
  for (let index = 1; index <= count; index += 1) {
    const anchor =
      frequency === "WEEKLY"
        ? addCalendarDays(from, 7 * index)
        : addCalendarMonths(from, index);
    const previous = dates.at(-1);
    let dueDate = workingDayOnOrAfter(anchor, holidays);
    if (previous !== undefined && dueDate <= previous) {
      dueDate = nextWorkingDay(previous, holidays);
    }
    dates.push(dueDate);
  }
  return dates;
}
