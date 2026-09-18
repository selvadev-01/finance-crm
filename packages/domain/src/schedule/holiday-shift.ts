import {
  addCalendarDays,
  type CalendarDate,
} from "../calendar/calendar-date.js";
import { type HolidaySet, workingDayRange } from "../calendar/working-days.js";

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
  /** The sector's holidays **after** the change — business-wide plus its own. */
  holidays: HolidaySet;
}

/**
 * BR-02 / US-034 / US-093: a holiday declared after a schedule was generated
 * shifts the remaining schedule; removing one shifts it back.
 *
 * Every pending slot due on or after `changedDate` keeps its sequence and its
 * amount and is laid again on consecutive working days, starting from the
 * first working day on or after `changedDate` (never on or before the
 * disbursement date). Slots due before it, and answered slots, are not moved —
 * so the balance and the sum of the schedule are unchanged, and only dates
 * move.
 *
 * > **Worked example (US-034).** Pending slots on Wed 14, Thu 15 and Fri
 * > 16 January. 15 January is declared a holiday: 14 stays, the 15th's slot
 * > moves to Fri 16 and the 16th's to Sat 17. Removing the holiday puts them
 * > back on 15 and 16.
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

  const dayBefore = addCalendarDays(input.changedDate, -1);
  const after =
    dayBefore > input.disbursementDate ? dayBefore : input.disbursementDate;
  const dates = workingDayRange(after, moving.length, input.holidays);

  return moving.flatMap((slot, index) => {
    const dueDate = dates[index]!;
    return dueDate === slot.dueDate
      ? []
      : [{ sequence: slot.sequence, dueDate }];
  });
}
