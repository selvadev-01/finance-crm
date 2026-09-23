import type { Decimal } from "decimal.js";

import type { CalendarDate } from "../calendar/calendar-date.js";
import type { HolidaySet } from "../calendar/working-days.js";
import { type MoneyInput, toMoney } from "../money/money.js";
import type { CollectionFrequency } from "./frequency.js";
import { generateSchedule, type ScheduleSlot } from "./schedule.js";

/**
 * US-030a — an account entered partway through its term.
 *
 * Decided 2026-09-13:
 * - The **collected-to-date** amount is what the customer has actually paid,
 *   up to and including the day of entry. It is entered, never inferred as
 *   `days × D` (M05).
 * - The slots that amount pays for keep their original dates, in order: each
 *   fully paid slot is `COLLECTED`, and a slot paid in part is `PARTIAL`.
 *   Nothing is recorded as `MISSED` — Rasi has no visits to say so.
 * - The rest of the balance is a regenerated tail (BR-06) starting the
 *   **next working day after entry**, so an account entered today first
 *   appears on tomorrow's route, exactly like a day-one account that had been
 *   collected down to the same outstanding (release gate 6).
 */
export interface MidTermInput {
  /** A */
  accountAmount: MoneyInput;
  /** D — one instalment, at `frequency`. */
  dailyAmount: MoneyInput;
  /** How often an instalment falls due (BR-04). */
  frequency: CollectionFrequency;
  /** Day 0 of the original term. Before `enteredOn`. */
  disbursementDate: CalendarDate;
  /** The business date the account is entered into Rasi. */
  enteredOn: CalendarDate;
  /** Paid before Rasi, `0 ≤ collected < A`. */
  collectedToDate: MoneyInput;
  holidays: HolidaySet;
}

export interface MidTermSlot extends ScheduleSlot {
  status: "COLLECTED" | "PARTIAL" | "PENDING";
}

export interface MidTermPlan {
  slots: MidTermSlot[];
  outstanding: Decimal;
  /**
   * How much less than the original schedule expected by `enteredOn` has been
   * paid — `0` when on time or ahead. Shown on the form (S-04) so a behind
   * customer is visible before saving.
   */
  amountBehind: Decimal;
  /** The first working day after disbursement (BR-03), from the original schedule. */
  firstCollectionDate: CalendarDate;
  /** The tail's last slot. */
  targetCompletionDate: CalendarDate;
}

export function planMidTermSchedule(input: MidTermInput): MidTermPlan {
  const accountAmount = toMoney(input.accountAmount, "accountAmount");
  const collected = toMoney(input.collectedToDate, "collectedToDate");
  if (!(input.disbursementDate < input.enteredOn)) {
    throw new RangeError(
      `A mid-term account is disbursed before it is entered: ${input.disbursementDate} is not before ${input.enteredOn}`,
    );
  }
  if (collected.isNegative() || collected.greaterThanOrEqualTo(accountAmount)) {
    throw new RangeError(
      `collectedToDate must be at least 0 and below the account amount, got ${collected.toString()}`,
    );
  }

  const original = generateSchedule({
    outstanding: accountAmount,
    dailyAmount: input.dailyAmount,
    after: input.disbursementDate,
    frequency: input.frequency,
    holidays: input.holidays,
    firstSequence: 1,
  });

  const paid: MidTermSlot[] = [];
  let remaining = collected;
  for (const slot of original) {
    if (remaining.lessThanOrEqualTo(0)) break;
    if (remaining.greaterThanOrEqualTo(slot.expectedAmount)) {
      paid.push({ ...slot, status: "COLLECTED" });
      remaining = remaining.minus(slot.expectedAmount);
    } else {
      paid.push({ ...slot, status: "PARTIAL" });
      remaining = toMoney("0");
    }
  }

  const outstanding = accountAmount.minus(collected);
  const tail = generateSchedule({
    outstanding,
    dailyAmount: input.dailyAmount,
    after: input.enteredOn,
    frequency: input.frequency,
    holidays: input.holidays,
    firstSequence: paid.length + 1,
  }).map((slot): MidTermSlot => ({ ...slot, status: "PENDING" }));

  const expectedByEntry = original
    .filter((slot) => slot.dueDate <= input.enteredOn)
    .reduce((total, slot) => total.plus(slot.expectedAmount), toMoney("0"));
  const behind = expectedByEntry.minus(collected);

  return {
    slots: [...paid, ...tail],
    outstanding,
    amountBehind: behind.isNegative() ? toMoney("0") : behind,
    firstCollectionDate: original[0]!.dueDate,
    targetCompletionDate: tail.at(-1)!.dueDate,
  };
}
