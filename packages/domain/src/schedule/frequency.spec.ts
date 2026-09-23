import { describe, expect, it } from "vitest";

import { parseCalendarDate } from "../calendar/calendar-date.js";
import {
  type HolidaySet,
  isWorkingDay,
  workingDayRange,
} from "../calendar/working-days.js";
import {
  COLLECTION_FREQUENCIES,
  collectionDueDates,
  isCollectionFrequency,
} from "./frequency.js";

const d = parseCalendarDate;
const NONE: HolidaySet = new Set();

// Wednesday. Day 0 at every cadence, so no schedule may put a slot on it.
const DISBURSED = d("2026-09-23");

describe("DAILY is exactly the working-day run it always was", () => {
  it("matches workingDayRange, holidays and all", () => {
    const holidays: HolidaySet = new Set([d("2026-09-25"), d("2026-10-02")]);
    expect(collectionDueDates(DISBURSED, 20, "DAILY", holidays)).toEqual(
      workingDayRange(DISBURSED, 20, holidays),
    );
  });
});

describe("WEEKLY — one instalment a week, on the same weekday", () => {
  const dates = collectionDueDates(DISBURSED, 5, "WEEKLY", NONE);

  it("starts a week after day 0, not the next day", () => {
    expect(dates[0]).toBe("2026-09-30");
  });

  it("stays on Wednesdays, seven days apart", () => {
    expect(dates).toEqual([
      "2026-09-30",
      "2026-10-07",
      "2026-10-14",
      "2026-10-21",
      "2026-10-28",
    ]);
  });

  it("moves only the visit that lands on a holiday, and does not drift after it", () => {
    const shifted = collectionDueDates(
      DISBURSED,
      5,
      "WEEKLY",
      new Set([d("2026-10-07")]),
    );
    // The 7th moves to the 8th; the 14th is still the 14th.
    expect(shifted).toEqual([
      "2026-09-30",
      "2026-10-08",
      "2026-10-14",
      "2026-10-21",
      "2026-10-28",
    ]);
  });

  it("moves a visit off a Sunday without moving the weekday for good", () => {
    // Disbursed Sunday 20 September: every anchor is a Sunday, so every visit
    // is the Monday after it — consistently, with no drift.
    const sunday = d("2026-09-20");
    expect(collectionDueDates(sunday, 3, "WEEKLY", NONE)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
  });
});

describe("MONTHLY — one instalment a month, on the same day of the month", () => {
  it("starts a month after day 0", () => {
    expect(collectionDueDates(DISBURSED, 3, "MONTHLY", NONE)).toEqual([
      "2026-10-23",
      "2026-11-23",
      "2026-12-23",
    ]);
  });

  it("clamps a 31st to a short month and then goes back to the 31st", () => {
    // Anchors 31 Jan, 28 Feb (clamped), 31 Mar, 30 Apr (clamped); the first
    // two are Sundays, so those visits land on the Monday. The anchors come
    // from day 0, so February borrowing a day never costs March one —
    // stepping month by month would leave every later visit on the 28th.
    expect(collectionDueDates(d("2026-12-31"), 4, "MONTHLY", NONE)).toEqual([
      "2027-02-01",
      "2027-03-01",
      "2027-03-31",
      "2027-04-30",
    ]);
  });
});

describe("every cadence keeps the schedule's invariants", () => {
  const holidays: HolidaySet = new Set([d("2026-10-07"), d("2026-10-23")]);

  it.each(COLLECTION_FREQUENCIES)(
    "%s puts every slot on a working day, after day 0, in strictly increasing order",
    (frequency) => {
      const dates = collectionDueDates(DISBURSED, 24, frequency, holidays);
      expect(dates).toHaveLength(24);
      for (const [index, date] of dates.entries()) {
        expect(isWorkingDay(date, holidays)).toBe(true);
        expect(date > DISBURSED).toBe(true);
        if (index > 0) expect(date > dates[index - 1]!).toBe(true);
      }
    },
  );

  it.each(COLLECTION_FREQUENCIES)(
    "%s returns nothing for no slots",
    (frequency) => {
      expect(collectionDueDates(DISBURSED, 0, frequency, NONE)).toEqual([]);
    },
  );

  it("refuses a count that is not a whole number of slots", () => {
    expect(() => collectionDueDates(DISBURSED, -1, "WEEKLY", NONE)).toThrow(
      RangeError,
    );
    expect(() => collectionDueDates(DISBURSED, 1.5, "MONTHLY", NONE)).toThrow(
      RangeError,
    );
  });
});

describe("isCollectionFrequency", () => {
  it.each(COLLECTION_FREQUENCIES)("accepts %s", (frequency) => {
    expect(isCollectionFrequency(frequency)).toBe(true);
  });

  it.each(["daily", "FORTNIGHTLY", ""])("rejects %j", (value) => {
    expect(isCollectionFrequency(value)).toBe(false);
  });
});
