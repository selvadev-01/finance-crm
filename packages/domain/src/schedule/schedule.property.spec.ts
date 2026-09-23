import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  fromEpochDay,
  parseCalendarDate,
  toEpochDay,
} from "../calendar/calendar-date.js";
import {
  countWorkingDays,
  type HolidaySet,
  isWorkingDay,
  workingDayRange,
} from "../calendar/working-days.js";
import {
  generateSchedule,
  scheduleSlotCount,
  targetCompletionDate,
} from "./schedule.js";

const paiseToMoney = (paise: number) => new Decimal(paise).dividedBy(100);

/**
 * An account: outstanding up to ₹50 lakh, and a daily amount large enough that
 * the schedule stays under 2,000 slots, so each run is quick.
 */
const account = fc
  .integer({ min: 1, max: 500_000_000 })
  .chain((outstandingPaise) =>
    fc.record({
      outstandingPaise: fc.constant(outstandingPaise),
      dailyPaise: fc.integer({
        min: Math.max(1, Math.ceil(outstandingPaise / 2_000)),
        max: outstandingPaise * 2,
      }),
      after: fc
        .integer({
          min: toEpochDay(parseCalendarDate("2000-01-01")),
          max: toEpochDay(parseCalendarDate("2080-12-31")),
        })
        .map(fromEpochDay),
      holidayOffsets: fc.array(fc.integer({ min: 1, max: 3_000 }), {
        maxLength: 40,
      }),
      firstSequence: fc.integer({ min: 1, max: 500 }),
    }),
  )
  .map((a) => ({
    outstanding: paiseToMoney(a.outstandingPaise),
    dailyAmount: paiseToMoney(a.dailyPaise),
    after: a.after,
    frequency: "DAILY" as const,
    holidays: new Set(
      a.holidayOffsets.map((offset) => addCalendarDays(a.after, offset)),
    ) as HolidaySet,
    firstSequence: a.firstSequence,
  }));

describe("schedule properties (BR-04, BR-06, BR-07)", () => {
  it("slots sum to exactly the outstanding balance", () => {
    fc.assert(
      fc.property(account, (input) => {
        const total = generateSchedule(input).reduce(
          (sum, slot) => sum.plus(slot.expectedAmount),
          new Decimal(0),
        );
        expect(total.equals(input.outstanding)).toBe(true);
      }),
    );
  });

  it("there are ceil(outstanding ÷ D) slots", () => {
    fc.assert(
      fc.property(account, (input) => {
        const expected = input.outstanding
          .dividedBy(input.dailyAmount)
          .ceil()
          .toNumber();
        expect(generateSchedule(input)).toHaveLength(expected);
        expect(scheduleSlotCount(input.outstanding, input.dailyAmount)).toBe(
          expected,
        );
      }),
    );
  });

  it("every slot but the last expects D; the last expects a remainder in (0, D]", () => {
    fc.assert(
      fc.property(account, (input) => {
        const slots = generateSchedule(input);
        const last = slots.at(-1);
        for (const slot of slots.slice(0, -1)) {
          expect(slot.expectedAmount.equals(input.dailyAmount)).toBe(true);
        }
        expect(last?.expectedAmount.greaterThan(0)).toBe(true);
        expect(last?.expectedAmount.lessThanOrEqualTo(input.dailyAmount)).toBe(
          true,
        );
      }),
    );
  });

  it("no amount has more than 2 decimal places", () => {
    fc.assert(
      fc.property(account, (input) => {
        for (const slot of generateSchedule(input)) {
          expect(slot.expectedAmount.decimalPlaces()).toBeLessThanOrEqual(2);
        }
      }),
    );
  });

  it("due dates are consecutive working days after the anchor, and sequences are contiguous", () => {
    fc.assert(
      fc.property(account, (input) => {
        const slots = generateSchedule(input);
        expect(slots.map((slot) => slot.dueDate)).toEqual(
          workingDayRange(input.after, slots.length, input.holidays),
        );
        slots.forEach((slot, index) => {
          expect(slot.sequence).toBe(input.firstSequence + index);
          expect(isWorkingDay(slot.dueDate, input.holidays)).toBe(true);
        });
      }),
    );
  });

  it("the target completion date is the last slot's due date", () => {
    fc.assert(
      fc.property(account, (input) => {
        const slots = generateSchedule(input);
        const target = targetCompletionDate(input);
        expect(target).toBe(slots.at(-1)?.dueDate);
        if (target !== null) {
          expect(countWorkingDays(input.after, target, input.holidays)).toBe(
            slots.length,
          );
        }
      }),
    );
  });

  it("regenerating after collecting slots exactly as planned reproduces the original tail (BR-06)", () => {
    fc.assert(
      fc.property(account, fc.nat(), (input, cut) => {
        const full = generateSchedule(input);
        const kept = cut % (full.length + 1);
        const head = full.slice(0, kept);
        const collected = head.reduce(
          (sum, slot) => sum.plus(slot.expectedAmount),
          new Decimal(0),
        );
        const tail = generateSchedule({
          ...input,
          outstanding: input.outstanding.minus(collected),
          after: head.at(-1)?.dueDate ?? input.after,
          firstSequence: input.firstSequence + kept,
        });
        expect([...head, ...tail]).toEqual(full);
      }),
    );
  });
});
