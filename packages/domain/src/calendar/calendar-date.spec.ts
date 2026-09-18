import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  dayOfWeek,
  daysBetween,
  fromUtcMidnight,
  isCalendarDate,
  parseCalendarDate,
  startOfMonth,
  toUtcMidnight,
} from "./calendar-date.js";

const d = parseCalendarDate;

describe("parseCalendarDate", () => {
  it("accepts a well-formed date", () => {
    expect(d("2026-01-05")).toBe("2026-01-05");
  });

  it.each([
    "2026-1-5",
    "05-01-2026",
    "2026-01-05T00:00:00Z",
    "",
    "2026/01/05",
    " 2026-01-05",
  ])("rejects the malformed value %j", (value) => {
    expect(() => d(value)).toThrow(RangeError);
  });

  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "1900-02-29",
  ])("rejects %s, which does not exist", (value) => {
    expect(() => d(value)).toThrow(RangeError);
  });

  it.each(["2024-02-29", "2028-02-29", "2000-02-29"])(
    "accepts the leap day %s",
    (value) => {
      expect(d(value)).toBe(value);
    },
  );

  it("isCalendarDate reports validity without throwing", () => {
    expect(isCalendarDate("2026-01-05")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
  });
});

describe("dayOfWeek", () => {
  it.each([
    ["2026-01-01", 4], // Thursday
    ["2026-01-03", 6], // Saturday — BR-03's disbursement example
    ["2026-01-04", 0], // Sunday
    ["2026-01-05", 1], // Monday
    ["2024-02-29", 4],
    ["2028-01-01", 6],
    ["1969-12-31", 3], // before the epoch
    ["1970-01-04", 0],
  ])("%s is day %i", (date, expected) => {
    expect(dayOfWeek(d(date))).toBe(expected);
  });
});

describe("addCalendarDays", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2027-02-28", 1, "2027-03-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-01-05", 365, "2027-01-05"],
  ])("%s + %i days is %s", (date, days, expected) => {
    expect(addCalendarDays(d(date), days)).toBe(expected);
  });
});

describe("daysBetween", () => {
  it.each([
    ["2026-01-05", "2026-01-05", 0],
    ["2026-01-05", "2026-01-06", 1],
    ["2026-01-06", "2026-01-05", -1],
    ["2028-02-01", "2028-03-01", 29],
    ["2026-12-31", "2027-01-01", 1],
  ])("from %s to %s is %i", (from, to, expected) => {
    expect(daysBetween(d(from), d(to))).toBe(expected);
  });
});

describe("startOfMonth", () => {
  it.each([
    ["2026-01-05", "2026-01-01"],
    ["2026-01-01", "2026-01-01"],
    ["2028-02-29", "2028-02-01"],
    ["2026-12-31", "2026-12-01"],
  ])("%s is in the month starting %s", (date, expected) => {
    expect(startOfMonth(d(date))).toBe(expected);
  });
});

describe("database date conversion", () => {
  it("round-trips through a Date at 00:00 UTC", () => {
    const date = d("2028-02-29");
    const stored = toUtcMidnight(date);
    expect(stored.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(fromUtcMidnight(stored)).toBe(date);
  });

  it("refuses an instant that is not midnight UTC rather than truncating it", () => {
    // 05:10 IST — truncating to the UTC date would give the wrong business date.
    expect(() => fromUtcMidnight(new Date("2026-01-04T23:40:00Z"))).toThrow(
      /toBusinessDate/,
    );
  });

  it("refuses an invalid Date", () => {
    expect(() => fromUtcMidnight(new Date("nope"))).toThrow(RangeError);
  });
});
