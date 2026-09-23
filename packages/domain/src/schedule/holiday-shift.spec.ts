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
      frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
        frequency: "DAILY" as const,
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
      frequency: "DAILY" as const,
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
            frequency: "DAILY" as const,
            holidays: after,
          }),
        );
        const removed = apply(
          declared,
          shiftForHolidayChange({
            pending: declared,
            changedDate: holiday,
            disbursementDate: input.disbursed,
            frequency: "DAILY" as const,
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
            frequency: "DAILY" as const,
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
          frequency: "DAILY" as const,
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

describe("a weekly account — only the visit on the holiday moves", () => {
  // Wednesdays: 30 September, 7 October, 14 October.
  const pending = [
    { sequence: 1, dueDate: d("2026-09-30") },
    { sequence: 2, dueDate: d("2026-10-07") },
    { sequence: 3, dueDate: d("2026-10-14") },
  ];
  const disbursementDate = d("2026-09-23");

  it("moves the 7th to the 8th and leaves the 14th alone", () => {
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-10-07"),
        disbursementDate,
        frequency: "WEEKLY",
        holidays: new Set([d("2026-10-07")]),
      }),
    ).toEqual([{ sequence: 2, dueDate: "2026-10-08" }]);
  });

  it("moves nothing when the holiday falls between two visits", () => {
    expect(
      shiftForHolidayChange({
        pending,
        changedDate: d("2026-10-09"),
        disbursementDate,
        frequency: "WEEKLY",
        holidays: new Set([d("2026-10-09")]),
      }),
    ).toEqual([]);
  });

  it("leaves a rescheduled visit where it is when the holiday is removed", () => {
    // The anchors never moved, so there is nothing to shift back — and the
    // customer has already been told the Thursday.
    expect(
      shiftForHolidayChange({
        pending: [
          { sequence: 1, dueDate: d("2026-09-30") },
          { sequence: 2, dueDate: d("2026-10-08") },
          { sequence: 3, dueDate: d("2026-10-14") },
        ],
        changedDate: d("2026-10-07"),
        disbursementDate,
        frequency: "WEEKLY",
        holidays: NONE,
      }),
    ).toEqual([]);
  });

  it("does not pile two visits onto one date when a run of holidays pushes one along", () => {
    const holidays = new Set([d("2026-10-07"), d("2026-10-08")]);
    const moved = shiftForHolidayChange({
      pending: [
        { sequence: 1, dueDate: d("2026-10-07") },
        { sequence: 2, dueDate: d("2026-10-09") },
      ],
      changedDate: d("2026-10-07"),
      disbursementDate,
      frequency: "WEEKLY",
      holidays,
    });
    expect(moved).toEqual([
      { sequence: 1, dueDate: "2026-10-09" },
      { sequence: 2, dueDate: "2026-10-10" },
    ]);
  });
});

describe("a weekly account — only the visit on the holiday moves", () => {
  // Wednesdays, as generateSchedule lays them for a weekly account.
  const pending = slots(
    [d("2026-09-30"), d("2026-10-07"), d("2026-10-14"), d("2026-10-21")],
    3,
  );
  const holiday = d("2026-10-07");

  it("moves that one visit to the next working day and leaves the rest alone", () => {
    const moved = shiftForHolidayChange({
      pending,
      changedDate: holiday,
      disbursementDate: d("2026-09-23"),
      frequency: "WEEKLY",
      holidays: new Set([holiday]),
    });
    expect(moved).toEqual([{ sequence: 4, dueDate: "2026-10-08" }]);
    expect(apply(pending, moved).map((slot) => slot.dueDate)).toEqual([
      "2026-09-30",
      "2026-10-08",
      "2026-10-14",
      "2026-10-21",
    ]);
  });

  it("does not pull a rescheduled visit back when the holiday is removed", () => {
    // The anchors never moved, and the customer has been told Thursday.
    const rescheduled = slots(
      [d("2026-09-30"), d("2026-10-08"), d("2026-10-14")],
      3,
    );
    expect(
      shiftForHolidayChange({
        pending: rescheduled,
        changedDate: holiday,
        disbursementDate: d("2026-09-23"),
        frequency: "WEEKLY",
        holidays: NONE,
      }),
    ).toEqual([]);
  });

  it("keeps the dates strictly increasing when a run of holidays pushes one visit onto the next", () => {
    const monthly = slots([d("2026-10-23"), d("2026-10-24")], 1);
    const moved = shiftForHolidayChange({
      pending: monthly,
      changedDate: d("2026-10-23"),
      disbursementDate: d("2026-09-23"),
      frequency: "MONTHLY",
      holidays: new Set([d("2026-10-23"), d("2026-10-24")]),
    });
    const dates = apply(monthly, moved).map((slot) => slot.dueDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual(["2026-10-26", "2026-10-27"]);
  });
});
