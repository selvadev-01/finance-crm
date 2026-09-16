import { afterEach, describe, expect, it, vi } from "vitest";

import { businessDayStart, toBusinessDate } from "./business-date.js";
import { addCalendarDays, parseCalendarDate } from "./calendar-date.js";

describe("toBusinessDate (BR-12)", () => {
  it("BR-12 worked example: 05:10 IST is the previous UTC day, but the same business date", () => {
    const instant = new Date("2026-01-05T05:10:00+05:30");
    expect(instant.toISOString()).toBe("2026-01-04T23:40:00.000Z");
    expect(toBusinessDate(instant)).toBe("2026-01-05");
  });

  it("BR-12 worked example: 23:40 IST is the same day in both zones", () => {
    expect(toBusinessDate(new Date("2026-01-05T23:40:00+05:30"))).toBe(
      "2026-01-05",
    );
  });

  it.each([
    [
      "one millisecond before IST midnight",
      "2026-01-04T18:29:59.999Z",
      "2026-01-04",
    ],
    ["exactly IST midnight", "2026-01-04T18:30:00.000Z", "2026-01-05"],
    [
      "UTC midnight, which is 05:30 IST",
      "2026-01-05T00:00:00.000Z",
      "2026-01-05",
    ],
    [
      "one millisecond before UTC midnight",
      "2026-01-04T23:59:59.999Z",
      "2026-01-05",
    ],
    [
      "the last instant of an IST day",
      "2026-01-05T18:29:59.999Z",
      "2026-01-05",
    ],
  ])("%s: %s → %s", (_label, iso, expected) => {
    expect(toBusinessDate(new Date(iso))).toBe(expected);
  });

  it.each([
    ["into a new year", "2026-12-31T18:30:00Z", "2027-01-01"],
    ["onto a leap day", "2028-02-28T18:30:00Z", "2028-02-29"],
    ["off a leap day", "2028-02-29T18:30:00Z", "2028-03-01"],
    ["into a new month", "2026-01-31T20:00:00Z", "2026-02-01"],
  ])("crosses %s: %s → %s", (_label, iso, expected) => {
    expect(toBusinessDate(new Date(iso))).toBe(expected);
  });

  it("rejects an invalid Date", () => {
    expect(() => toBusinessDate(new Date("not a date"))).toThrow(RangeError);
  });

  // The development machine runs in IST, where a naive local-date conversion
  // gives the right answer by accident. Only a foreign TZ exposes it.
  describe("does not depend on the server's timezone", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati"])(
      "with TZ=%s",
      (zone) => {
        vi.stubEnv("TZ", zone);
        expect(toBusinessDate(new Date("2026-01-04T23:40:00Z"))).toBe(
          "2026-01-05",
        );
        expect(toBusinessDate(new Date("2026-01-04T18:29:59Z"))).toBe(
          "2026-01-04",
        );
      },
    );
  });
});

describe("businessDayStart", () => {
  it("is IST midnight: 5 Jan 2026 begins at 18:30 UTC on 4 Jan", () => {
    expect(businessDayStart(parseCalendarDate("2026-01-05")).toISOString()).toBe(
      "2026-01-04T18:30:00.000Z",
    );
  });

  it("round-trips through toBusinessDate, and a millisecond earlier is the day before, for every day of 2024–2026", () => {
    for (let day = 0; day < 1096; day += 1) {
      const date = addCalendarDays(parseCalendarDate("2024-01-01"), day);
      const start = businessDayStart(date);
      expect(toBusinessDate(start)).toBe(date);
      expect(toBusinessDate(new Date(start.getTime() - 1))).toBe(addCalendarDays(date, -1));
    }
  });
});
