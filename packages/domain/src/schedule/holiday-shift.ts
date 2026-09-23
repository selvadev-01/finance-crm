import {
  addCalendarDays,
  type CalendarDate,
} from "../calendar/calendar-date.js";
import {
  type HolidaySet,
  nextWorkingDay,
  workingDayOnOrAfter,
  workingDayRange,
} from "../calendar/working-days.js";
import type { CollectionFrequency } from "./frequency.js";

/** A pending slot as the shift sees it: which instalment, and when. */
export interface SlotDate {
  sequence: number;
  dueDate: CalendarDate;
}

export interface HolidayShiftInput {
  /** The account's `PENDING` slots, in any order. Answered slots are never passed. */
  pending: readonly SlotDate[];
  /** The date just declared a holiday, or just removed as one. */
  changedDate: CalendarDate;
  /** Day 0 (BR-03): no slot may fall on or before it. */
  disbursementDate: CalendarDate;
  /** The account's cadence — it decides which of the two rules below applies. */
  frequency: CollectionFrequency;
  /** The sector's holidays **after** the change — business-wide plus its own. */
  holidays: HolidaySet;
}

/**
 * BR-02 / US-034 / US-093: a holiday declared after a schedule was generated
 * shifts the remaining schedule. Answered slots and balances are never
 * touched, so only dates move and the sum of the schedule is unchanged.
 *
 * The rule follows the account's cadence, because the two cadences mean
 * different things by "the next collection day".
 *
 * **DAILY — the whole tail slides, and slides back.** Every pending slot due
 * on or after `changedDate` keeps its sequence and its amount and is laid
 * again on consecutive working days from the first working day on or after
 * `changedDate` (never on or before the disbursement date). A daily schedule
 * is a run with no gaps, so losing a day pushes everything after it.
 *
 * > **Worked example (US-034).** Pending slots on Wed 14, Thu 15 and Fri
 * > 16 January. 15 January is declared a holiday: 14 stays, the 15th's slot
 * > moves to Fri 16 and the 16th's to Sat 17. Removing the holiday puts them
 * > back on 15 and 16.
 *
 * **WEEKLY / MONTHLY — only the visit that lands on the holiday moves.** Each
 * pending slot sits on its own calendar anchor with weeks or months of gap
 * around it, so a holiday costs one visit its date and nothing else: that slot
 * moves forward to the next working day, and every other slot keeps the date
 * it had. Removing a holiday then moves nothing — the anchors never changed,
 * and a visit already rescheduled to the Friday stays on the Friday rather
 * than being pulled back to a Thursday the customer was not told about.
 *
 * > A weekly account collected on Thursdays, with 8 October declared a
 * > holiday: that visit moves to Fri 9 October, while 1 and 15 October stay
 * > where they are.
 *
 * Returns only the slots whose date changes, with their new dates, in
 * sequence order — an empty list means the account is not affected (for
 * instance, its sector already had a holiday on that date).
 */
export function shiftForHolidayChange(input: HolidayShiftInput): SlotDate[] {
  const moving = input.pending
    .filter((slot) => slot.dueDate >= input.changedDate)
    .sort((a, b) => a.sequence - b.sequence);
  if (moving.length === 0) return [];

  const dates =
    input.frequency === "DAILY"
      ? dailyRun(input, moving.length)
      : perAnchorDates(input, moving);

  return moving.flatMap((slot, index) => {
    const dueDate = dates[index]!;
    return dueDate === slot.dueDate
      ? []
      : [{ sequence: slot.sequence, dueDate }];
  });
}

/** DAILY: one unbroken run of working days from just before the change. */
function dailyRun(input: HolidayShiftInput, count: number): CalendarDate[] {
  const dayBefore = addCalendarDays(input.changedDate, -1);
  const after =
    dayBefore > input.disbursementDate ? dayBefore : input.disbursementDate;
  return workingDayRange(after, count, input.holidays);
}

/**
 * WEEKLY / MONTHLY: every slot keeps its own date unless that date is no
 * longer a working day, in which case it moves forward to the next one. The
 * `previous` guard keeps the dates strictly increasing in the corner case
 * where a slot is pushed onto the one after it.
 */
function perAnchorDates(
  input: HolidayShiftInput,
  moving: readonly SlotDate[],
): CalendarDate[] {
  const dates: CalendarDate[] = [];
  for (const slot of moving) {
    const previous = dates.at(-1);
    let dueDate = workingDayOnOrAfter(slot.dueDate, input.holidays);
    if (previous !== undefined && dueDate <= previous) {
      dueDate = nextWorkingDay(previous, input.holidays);
    }
    dates.push(dueDate);
  }
  return dates;
}
