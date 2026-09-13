import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  type CalendarDate,
  fromEpochDay,
  parseCalendarDate,
  toEpochDay,
} from "./calendar-date.js";
import {
  addWorkingDays,
  countWorkingDays,
  type HolidaySet,
  isWorkingDay,
  nextWorkingDay,
  workingDayRange,
} from "./working-days.js";

const d = parseCalendarDate;

// 1990-01-01 … 2100-12-31. 2000 is a leap year, 2100 is not.
const MIN_DAY = toEpochDay(d("1990-01-01"));
const MAX_DAY = toEpochDay(d("2100-12-31"));

const calendarDate = fc
  .integer({ min: MIN_DAY, max: MAX_DAY })
  .map(fromEpochDay);

/** A start date plus holidays clustered within a year after it, so they actually land in range. */
const scenario = fc
  .tuple(
    calendarDate,
    fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 60 }),
  )
  .map(([start, offsets]) => ({
    start,
    holidays: new Set(
      offsets.map((offset) => addCalendarDays(start, offset)),
    ) as HolidaySet,
  }));

const count = fc.integer({ min: 0, max: 300 });

describe("working-day properties", () => {
  it("countWorkingDays(d, addWorkingDays(d, n)) === n for all n (M06)", () => {
    fc.assert(
      fc.property(scenario, count, ({ start, holidays }, n) => {
        expect(
          countWorkingDays(start, addWorkingDays(start, n, holidays), holidays),
        ).toBe(n);
      }),
    );
  });

  it("addWorkingDays is additive: adding a then b equals adding a + b", () => {
    fc.assert(
      fc.property(scenario, count, count, ({ start, holidays }, a, b) => {
        const stepped = addWorkingDays(
          addWorkingDays(start, a, holidays),
          b,
          holidays,
        );
        expect(stepped).toBe(addWorkingDays(start, a + b, holidays));
      }),
    );
  });

  it("nextWorkingDay is strictly later, a working day, and skips no working day", () => {
    fc.assert(
      fc.property(scenario, ({ start, holidays }) => {
        const next = nextWorkingDay(start, holidays);
        expect(next > start).toBe(true);
        expect(isWorkingDay(next, holidays)).toBe(true);
        for (
          let day = addCalendarDays(start, 1);
          day < next;
          day = addCalendarDays(day, 1)
        ) {
          expect(isWorkingDay(day, holidays)).toBe(false);
        }
      }),
    );
  });

  it("workingDayRange is n ascending working days ending at addWorkingDays(from, n)", () => {
    fc.assert(
      fc.property(scenario, count, ({ start, holidays }, n) => {
        const range = workingDayRange(start, n, holidays);
        expect(range).toHaveLength(n);
        let previous: CalendarDate = start;
        for (const date of range) {
          expect(date > previous).toBe(true);
          expect(isWorkingDay(date, holidays)).toBe(true);
          previous = date;
        }
        expect(previous).toBe(addWorkingDays(start, n, holidays));
      }),
    );
  });

  it("counting over a single day is 1 exactly when that day is a working day", () => {
    fc.assert(
      fc.property(scenario, ({ start, holidays }) => {
        const day = addCalendarDays(start, 1);
        expect(countWorkingDays(start, day, holidays)).toBe(
          isWorkingDay(day, holidays) ? 1 : 0,
        );
      }),
    );
  });

  it("countWorkingDays is additive over adjacent ranges", () => {
    fc.assert(
      fc.property(scenario, count, count, ({ start, holidays }, a, b) => {
        const middle = addCalendarDays(start, a);
        const end = addCalendarDays(middle, b);
        expect(countWorkingDays(start, end, holidays)).toBe(
          countWorkingDays(start, middle, holidays) +
            countWorkingDays(middle, end, holidays),
        );
      }),
    );
  });
});

describe("exhaustive: every start date 2024–2028", () => {
  // Leap years 2024 and 2028 at both ends; holidays next to Sundays, in runs, and across a year end.
  const holidays: HolidaySet = new Set(
    [
      "2024-01-01",
      "2024-01-15",
      "2024-01-26",
      "2024-08-15",
      "2024-10-31",
      "2024-11-01",
      "2025-01-14",
      "2025-03-14",
      "2025-08-15",
      "2025-10-20",
      "2025-10-21",
      "2025-12-31",
      "2026-01-01",
      "2026-01-14",
      "2026-01-26",
      "2026-03-04",
      "2026-10-17",
      "2026-10-19",
      "2027-01-26",
      "2027-02-27",
      "2027-03-01",
      "2027-11-08",
      "2027-12-31",
      "2028-01-01",
      "2028-02-29",
      "2028-08-15",
      "2028-12-30",
    ].map(d),
  );
  const first = toEpochDay(d("2024-01-01"));
  const last = toEpochDay(d("2028-12-31"));

  it("round-trips addWorkingDays through countWorkingDays for n in 0…130", () => {
    for (let day = first; day <= last; day += 1) {
      const start = fromEpochDay(day);
      let current = start;
      for (let n = 0; n <= 130; n += 1) {
        if (n > 0) current = nextWorkingDay(current, holidays);
        if (countWorkingDays(start, current, holidays) !== n) {
          throw new Error(`count(${start}, ${current}) !== ${n}`);
        }
      }
      expect(addWorkingDays(start, 130, holidays)).toBe(current);
    }
  });
});
