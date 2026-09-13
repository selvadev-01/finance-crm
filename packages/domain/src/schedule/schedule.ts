import { Decimal } from "decimal.js";

import type { CalendarDate } from "../calendar/calendar-date.js";
import {
  addWorkingDays,
  type HolidaySet,
  workingDayRange,
} from "../calendar/working-days.js";
import { type MoneyInput, toMoney, toPaise } from "../money/money.js";

/**
 * Schedule generation (M05, BR-04, BR-06, BR-07).
 *
 * One function serves both the initial schedule and every regenerated tail,
 * because they are the same calculation: lay `min(D, remaining)` on
 * consecutive working days until the balance is used up.
 *
 * - **Initial:** `outstanding = A`, `after = disbursementDate`, `firstSequence = 1`.
 * - **Regenerated tail (BR-06):** `outstanding` is the current balance, `after`
 *   the business date the tail follows, `firstSequence` one past the last slot
 *   kept. Which date that is — especially for a mid-term account (US-030a) —
 *   is the account service's decision, not this module's.
 *
 * A mid-term account and a day-one account with the same outstanding, daily
 * amount and anchor date get identical slots, because nothing else is an input
 * (release gate 6).
 */
export interface ScheduleSlot {
  /** 1-based, contiguous from `firstSequence`. */
  sequence: number;
  /** Always a working day (BR-02). */
  dueDate: CalendarDate;
  /** `min(D, outstanding remaining before this slot)` — always `> 0` (BR-07). */
  expectedAmount: Decimal;
}

export interface ScheduleInput {
  /** The balance the schedule must clear. `≤ 0` means nothing is left to schedule. */
  outstanding: MoneyInput;
  /** `D`. Must be `> 0`. */
  dailyAmount: MoneyInput;
  /** Day 0 — slots start on the next working day after it (BR-03). */
  after: CalendarDate;
  /** Resolved for the account's sector: business-wide plus that sector's own. */
  holidays: HolidaySet;
}

/**
 * BR-04: `ceil(outstanding ÷ D)` slots — derived from the balance, not from the
 * term `N`. Zero when nothing is outstanding.
 */
export function scheduleSlotCount(
  outstanding: MoneyInput,
  dailyAmount: MoneyInput,
): number {
  const remaining = toPaise(toMoney(outstanding, "outstanding"));
  const daily = toPaise(toPositiveDaily(dailyAmount));
  if (remaining <= 0n) return 0;
  // Integer ceiling division on paise: exact, with no decimal precision to configure.
  return Number((remaining + daily - 1n) / daily);
}

/**
 * BR-04: the slots that clear `outstanding`. Every slot expects `D` except the
 * last, which expects the remainder, so the slots sum to exactly `outstanding`.
 *
 * > `A = 10,000`, `D = 150` → 67 slots; 1–66 expect ₹150, slot 67 expects ₹100.
 */
export function generateSchedule(
  input: ScheduleInput & { firstSequence: number },
): ScheduleSlot[] {
  const { after, holidays, firstSequence } = input;
  if (!Number.isSafeInteger(firstSequence) || firstSequence < 1) {
    throw new RangeError(
      `firstSequence must be an integer ≥ 1, got ${firstSequence}`,
    );
  }
  const outstanding = toMoney(input.outstanding, "outstanding");
  const daily = toPositiveDaily(input.dailyAmount);

  const count = scheduleSlotCount(outstanding, daily);
  const dueDates = workingDayRange(after, count, holidays);

  let remaining = outstanding;
  return dueDates.map((dueDate, index) => {
    const expectedAmount = capExpectedAmount(daily, remaining);
    remaining = remaining.minus(expectedAmount);
    return { sequence: firstSequence + index, dueDate, expectedAmount };
  });
}

/**
 * BR-06: the date of the last slot `generateSchedule` would produce —
 * the `ceil(outstanding ÷ D)`-th working day after `after`. `null` when nothing
 * is outstanding: the account completes (BR-05) rather than getting a date.
 *
 * > `A = 10,000`, `D = 100`, 50 days paid, ₹80 on day 51 → outstanding ₹4,920,
 * > 50 more working days after day 51 → day 101.
 */
export function targetCompletionDate(
  input: ScheduleInput,
): CalendarDate | null {
  const count = scheduleSlotCount(input.outstanding, input.dailyAmount);
  return count === 0
    ? null
    : addWorkingDays(input.after, count, input.holidays);
}

/**
 * BR-07: `expected = min(D, outstanding)`. A customer with ₹80 left is shown
 * ₹80, so the final day never over-collects. `0` once nothing is outstanding.
 */
export function capExpectedAmount(
  dailyAmount: MoneyInput,
  outstanding: MoneyInput,
): Decimal {
  const daily = toPositiveDaily(dailyAmount);
  const remaining = toMoney(outstanding, "outstanding");
  if (remaining.lessThanOrEqualTo(0)) return new Decimal(0);
  return Decimal.min(daily, remaining);
}

function toPositiveDaily(value: MoneyInput): Decimal {
  const daily = toMoney(value, "dailyAmount");
  if (daily.lessThanOrEqualTo(0)) {
    throw new RangeError(
      `dailyAmount must be > 0 (BR-01), got ${daily.toString()}`,
    );
  }
  return daily;
}
