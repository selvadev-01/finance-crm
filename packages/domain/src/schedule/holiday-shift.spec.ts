import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  type CalendarDate,
  dayOfWeek,
  parseCalendarDate,
} from "../calendar/calendar-date.js";
import { type HolidaySet, workingDayRange } from "../calendar/working-days.js";
import { type SlotDate, shiftForHolidayChange } from "./holiday-shift.js";

const d = parseCalendarDate;
const NONE: HolidaySet = new Set();

/** Slots `first..` on the given dates. */
const slots = (dates: CalendarDate[], first = 1): SlotDate[] =>
  dates.map((dueDate, index) => ({ sequence: first + index, dueDate }));

/** The full pending schedule after applying a shift. */
const apply = (pending: SlotDate[], moved: SlotDate[]): SlotDate[] =>
  pending.map(
    (slot) => moved.find((next) => next.sequence === slot.sequence) ?? slot,
  );

describe("US-034 worked example — pending slots on 14, 15 and 16 January 2026", () => {
  const pending = slots([d("2026-01-14"), d("2026-01-15"), d("2026-01-16")], 8);
  const holiday = d("2026-01-15");

  it("moves the 15 January slot to the next working day and the later slot with it; 14 January stays", () => {
    const moved = shiftForHolidayChange({
      pending,
      changedDate: holiday,
      disbursementDate: d("2026-01-03"),
      holidays: new Set([holiday]),
    });
    expect(moved).toEqual([
      { sequence: 9, dueDate: "2026-01-16" },
      { sequence: 10, dueDate: "2026-01-17" },
    ]);
  });

  it("moves them back when the holiday is removed", () => {
    const shifted = apply(pending, [
      { sequence: 9, dueDate: d("2026-01-16") },
      { sequence: 10, dueDate: d("2026-01-17") },
    ]);
    expect(
      shiftForHolidayChange({
        pending: shifted,
        changedDate: holiday,
        disbursementDate: d("2026-01-03"),
        holidays: NONE,
      }),
    ).toEqual([
      { sequence: 9, dueDate: "2026-01-15" },
      { sequence: 10, dueDate: "2026-01-16" },
    ]);
  });
});

describe("shiftForHolidayChange (BR-02, US-093)", () => {
  it("steps over a Sunday: a Saturday holiday moves that slot to Monday", () => {
    const pending = slots([d("2026-01-16"), d("2026-01-17"), d("2026-01-19")]);
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-17"),
        disbursementDate: d("2026-01-01"),
        holidays: new Set([d("2026-01-17")]),
      }),
    ).toEqual([
      { sequence: 2, dueDate: "2026-01-19" },
      { sequence: 3, dueDate: "2026-01-20" },
    ]);
  });

  it("steps over a run of holidays declared one after another", () => {
    const pending = slots(workingDayRange(d("2026-01-12"), 5, NONE));
    const first = new Set([d("2026-01-14")]);
    const afterFirst = apply(
      pending,
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-14"),
        disbursementDate: d("2026-01-01"),
        holidays: first,
      }),
    );
    const both = new Set([d("2026-01-14"), d("2026-01-15")]);
    const afterBoth = apply(
      afterFirst,
      shiftForHolidayChange({
        pending: afterFirst,
        changedDate: d("2026-01-15"),
        disbursementDate: d("2026-01-01"),
        holidays: both,
      }),
    );
    expect(afterBoth.map((slot) => slot.dueDate)).toEqual([
      "2026-01-13",
      "2026-01-16",
      "2026-01-17",
      "2026-01-19",
      "2026-01-20",
    ]);
  });

  it("leaves an account alone when its sector already had a holiday on that date", () => {
    // A sector holiday on the 15th already moved these slots; a business-wide
    // holiday on the same date changes nothing.
    const holidays = new Set([d("2026-01-15")]);
    const pending = slots(workingDayRange(d("2026-01-13"), 3, holidays));
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-15"),
        disbursementDate: d("2026-01-01"),
        holidays,
      }),
    ).toEqual([]);
  });

  it("leaves an account alone when every pending slot is before the date", () => {
    const pending = slots([d("2026-01-12"), d("2026-01-13")]);
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-20"),
        disbursementDate: d("2026-01-10"),
        holidays: new Set([d("2026-01-20")]),
      }),
    ).toEqual([]);
  });

  it("never lays a slot on or before the disbursement date (BR-03)", () => {
    // Not yet disbursed; disbursement on the 20th, after the holiday removed on the 15th.
    const holidays = NONE;
    const pending = slots(workingDayRange(d("2026-01-20"), 3, holidays));
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-15"),
        disbursementDate: d("2026-01-20"),
        holidays,
      }),
    ).toEqual([]);
  });

  it("moves an account's first slot when the holiday falls on it", () => {
    const pending = slots(workingDayRange(d("2026-01-14"), 2, NONE));
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-01-15"),
        disbursementDate: d("2026-01-14"),
        holidays: new Set([d("2026-01-15")]),
      }),
    ).toEqual([
      { sequence: 1, dueDate: "2026-01-16" },
      { sequence: 2, dueDate: "2026-01-17" },
    ]);
  });

  it("returns slots in sequence order whatever order they were passed in", () => {
    const pending = slots(workingDayRange(d("2026-01-14"), 3, NONE)).reverse();
    const moved = shiftForHolidayChange({
      pending,
      changedDate: d("2026-01-15"),
      disbursementDate: d("2026-01-01"),
      holidays: new Set([d("2026-01-15")]),
    });
    expect(moved.map((slot) => slot.sequence)).toEqual([1, 2, 3]);
  });
});

describe("shiftForHolidayChange — properties", () => {
  const start = fc
    .integer({ min: 0, max: 3650 })
    .map((offset) => addCalendarDays(d("2024-01-01"), offset));

  const scenario = fc.record({
    disbursed: start,
    count: fc.integer({ min: 1, max: 120 }),
    holidayOffset: fc.integer({ min: 1, max: 200 }),
    existing: fc.uniqueArray(fc.integer({ min: 1, max: 200 }), {
      maxLength: 8,
    }),
  });

  const build = (input: {
    disbursed: CalendarDate;
    count: number;
    holidayOffset: number;
    existing: number[];
  }) => {
    const before: HolidaySet = new Set(
      input.existing
        .map((offset) => addCalendarDays(input.disbursed, offset))
        .filter((date) => dayOfWeek(date) !== 0),
    );
    const holiday = addCalendarDays(input.disbursed, input.holidayOffset);
    const after: HolidaySet = new Set([...before, holiday]);
    const pending = slots(
      workingDayRange(input.disbursed, input.count, before),
    );
    return { before, after, holiday, pending };
  };

  it("declaring then removing a holiday restores every date", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { before, after, holiday, pending } = build(input);
        if (dayOfWeek(holiday) === 0 || before.has(holiday)) return;
        const declared = apply(
          pending,
          shiftForHolidayChange({
            pending,
            changedDate: holiday,
            disbursementDate: input.disbursed,
            holidays: after,
          }),
        );
        const removed = apply(
          declared,
          shiftForHolidayChange({
            pending: declared,
            changedDate: holiday,
            disbursementDate: input.disbursed,
            holidays: before,
          }),
        );
        expect(removed).toEqual(pending);
      }),
    );
  });

  it("the shifted schedule is exactly the schedule generated with the holiday known", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { after, holiday, pending } = build(input);
        if (dayOfWeek(holiday) === 0) return;
        const shifted = apply(
          pending,
          shiftForHolidayChange({
            pending,
            changedDate: holiday,
            disbursementDate: input.disbursed,
            holidays: after,
          }),
        );
        expect(shifted.map((slot) => slot.dueDate)).toEqual(
          workingDayRange(input.disbursed, input.count, after),
        );
        expect(shifted.map((slot) => slot.sequence)).toEqual(
          pending.map((slot) => slot.sequence),
        );
      }),
    );
  });

  it("only slots on or after the holiday move, and only later", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { after, holiday, pending } = build(input);
        const moved = shiftForHolidayChange({
          pending,
          changedDate: holiday,
          disbursementDate: input.disbursed,
          holidays: after,
        });
        for (const slot of moved) {
          const original = pending.find((p) => p.sequence === slot.sequence)!;
          expect(original.dueDate >= holiday).toBe(true);
          expect(slot.dueDate > original.dueDate).toBe(true);
          expect(slot.dueDate).not.toBe(holiday);
        }
      }),
    );
  });
});
