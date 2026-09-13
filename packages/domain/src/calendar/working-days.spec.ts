import { describe, expect, it } from "vitest";

import { dayOfWeek, parseCalendarDate } from "./calendar-date.js";
import {
  addWorkingDays,
  countWorkingDays,
  type HolidaySet,
  isWorkingDay,
  nextWorkingDay,
  workingDayRange,
} from "./working-days.js";

const d = parseCalendarDate;
const holidays = (...dates: string[]): HolidaySet => new Set(dates.map(d));
const NONE = holidays();

describe("isWorkingDay (BR-02)", () => {
  it.each([
    ["2026-01-05", "Monday", true],
    ["2026-01-06", "Tuesday", true],
    ["2026-01-07", "Wednesday", true],
    ["2026-01-08", "Thursday", true],
    ["2026-01-09", "Friday", true],
    ["2026-01-10", "Saturday", true],
    ["2026-01-11", "Sunday", false],
  ])("%s (%s) is a working day: %s", (date, _weekday, expected) => {
    expect(isWorkingDay(d(date), NONE)).toBe(expected);
  });

  it("a declared holiday is not a working day", () => {
    expect(isWorkingDay(d("2026-01-14"), holidays("2026-01-14"))).toBe(false);
  });

  it("a holiday on another date does not affect this one", () => {
    expect(isWorkingDay(d("2026-01-13"), holidays("2026-01-14"))).toBe(true);
  });

  it("a Sunday stays excluded whether or not it is also a holiday", () => {
    expect(isWorkingDay(d("2026-01-11"), holidays("2026-01-11"))).toBe(false);
  });
});

describe("nextWorkingDay", () => {
  it("BR-03 worked example: disbursed Saturday 3 Jan, first collection Monday 5 Jan", () => {
    expect(nextWorkingDay(d("2026-01-03"), NONE)).toBe("2026-01-05");
  });

  it.each([
    ["2026-01-05", "Monday", "2026-01-06"],
    ["2026-01-06", "Tuesday", "2026-01-07"],
    ["2026-01-07", "Wednesday", "2026-01-08"],
    ["2026-01-08", "Thursday", "2026-01-09"],
    ["2026-01-09", "Friday", "2026-01-10"],
    ["2026-01-10", "Saturday", "2026-01-12"],
    ["2026-01-11", "Sunday", "2026-01-12"],
  ])(
    "from %s (%s) is %s — strictly after, never the same day",
    (date, _weekday, expected) => {
      expect(nextWorkingDay(d(date), NONE)).toBe(expected);
    },
  );

  it("skips consecutive holidays", () => {
    const h = holidays("2026-01-14", "2026-01-15", "2026-01-16");
    expect(nextWorkingDay(d("2026-01-13"), h)).toBe("2026-01-17");
  });

  it("skips a Saturday holiday and the Sunday after it", () => {
    expect(nextWorkingDay(d("2026-01-09"), holidays("2026-01-10"))).toBe(
      "2026-01-12",
    );
  });

  it("skips a Sunday and a Monday holiday after it", () => {
    expect(nextWorkingDay(d("2026-01-24"), holidays("2026-01-26"))).toBe(
      "2026-01-27",
    );
  });

  it("skips a holiday run spanning a Sunday", () => {
    const h = holidays("2026-10-17", "2026-10-19", "2026-10-20"); // Sat, Mon, Tue
    expect(nextWorkingDay(d("2026-10-16"), h)).toBe("2026-10-21");
  });

  it.each([
    ["month", "2026-01-31", "2026-02-02"], // Sat → Sunday 1 Feb skipped
    ["quarter", "2026-03-31", "2026-04-01"],
    ["year", "2026-12-31", "2027-01-01"],
    ["year onto a Saturday", "2027-12-31", "2028-01-01"],
    ["leap day", "2028-02-28", "2028-02-29"],
    ["leap day into March", "2024-02-29", "2024-03-01"],
    ["non-leap February", "2027-02-27", "2027-03-01"], // Sat → Sunday 28 Feb skipped
  ])("crosses a %s boundary: %s → %s", (_label, date, expected) => {
    expect(nextWorkingDay(d(date), NONE)).toBe(expected);
  });

  it("skips a New Year holiday across the year boundary", () => {
    expect(nextWorkingDay(d("2026-12-31"), holidays("2027-01-01"))).toBe(
      "2027-01-02",
    );
  });
});

describe("addWorkingDays", () => {
  it("adding zero returns the start date, even when it is not a working day", () => {
    expect(addWorkingDays(d("2026-01-11"), 0, NONE)).toBe("2026-01-11");
  });

  it("adding one is the next working day", () => {
    expect(addWorkingDays(d("2026-01-03"), 1, NONE)).toBe("2026-01-05");
  });

  it("six working days from a Monday lands on the next Monday", () => {
    expect(addWorkingDays(d("2026-01-05"), 6, NONE)).toBe("2026-01-12");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects n = %s",
    (n) => {
      expect(() => addWorkingDays(d("2026-01-05"), n, NONE)).toThrow(
        RangeError,
      );
    },
  );
});

describe("countWorkingDays — counts (from, to]", () => {
  it("is zero for the same date", () => {
    expect(countWorkingDays(d("2026-01-05"), d("2026-01-05"), NONE)).toBe(0);
  });

  it("excludes from and includes to", () => {
    expect(countWorkingDays(d("2026-01-05"), d("2026-01-06"), NONE)).toBe(1);
  });

  it.each([
    ["Saturday to Monday", "2026-01-10", "2026-01-12", 1],
    ["Sunday to Monday", "2026-01-11", "2026-01-12", 1],
    ["Friday to Sunday", "2026-01-09", "2026-01-11", 1],
    ["Saturday to Sunday", "2026-01-10", "2026-01-11", 0],
    ["a full week", "2026-01-04", "2026-01-11", 6],
    ["all of January 2026", "2025-12-31", "2026-01-31", 27],
    ["all of February 2028 (leap)", "2028-01-31", "2028-02-29", 25],
    ["all of 2026", "2025-12-31", "2026-12-31", 313],
    ["all of 2028 (leap, 53 Sundays)", "2027-12-31", "2028-12-31", 313],
  ])("%s: %i", (_label, from, to, expected) => {
    expect(countWorkingDays(d(from), d(to), NONE)).toBe(expected);
  });

  it("subtracts holidays inside the range only", () => {
    const h = holidays("2026-01-05", "2026-01-07", "2026-01-12");
    // (5 Jan, 10 Jan] = 6,7,8,9,10 → 5 days, minus 7 Jan. 5 Jan is `from`, 12 Jan is outside.
    expect(countWorkingDays(d("2026-01-05"), d("2026-01-10"), h)).toBe(4);
  });

  it("does not subtract a holiday that falls on a Sunday twice", () => {
    expect(
      countWorkingDays(
        d("2026-01-04"),
        d("2026-01-11"),
        holidays("2026-01-11"),
      ),
    ).toBe(6);
  });

  it("counts correctly before the Unix epoch", () => {
    // Sat 27 Dec 1969 → Sat 3 Jan 1970: one Sunday (28 Dec) in the seven days.
    expect(countWorkingDays(d("1969-12-27"), d("1970-01-03"), NONE)).toBe(6);
  });

  it("rejects a range that ends before it starts", () => {
    expect(() =>
      countWorkingDays(d("2026-01-06"), d("2026-01-05"), NONE),
    ).toThrow(RangeError);
  });
});

describe("workingDayRange", () => {
  it("is empty for a count of zero", () => {
    expect(workingDayRange(d("2026-01-05"), 0, NONE)).toEqual([]);
  });

  it("starts after `from` and skips Sundays", () => {
    expect(workingDayRange(d("2026-01-08"), 4, NONE)).toEqual([
      "2026-01-09",
      "2026-01-10",
      "2026-01-12",
      "2026-01-13",
    ]);
  });

  it("a holiday pushes every later date forward by one working day", () => {
    const before = workingDayRange(d("2026-01-13"), 3, NONE);
    const after = workingDayRange(d("2026-01-13"), 3, holidays("2026-01-15"));
    expect(before).toEqual(["2026-01-14", "2026-01-15", "2026-01-16"]);
    expect(after).toEqual(["2026-01-14", "2026-01-16", "2026-01-17"]);
  });

  it("rejects a negative count", () => {
    expect(() => workingDayRange(d("2026-01-05"), -1, NONE)).toThrow(
      RangeError,
    );
  });
});

/**
 * A full 100-day schedule, computed by hand from a printed calendar rather than
 * by any code under test (M06 testing). Disbursed Saturday 3 January 2026, with
 * holidays on Wed 14 Jan, Mon 26 Jan and Wed 4 Mar. Each line is one Mon–Sat
 * week; the trailing comment is the running slot count.
 */
describe("hand-verified 100-day schedule", () => {
  const disbursement = d("2026-01-03");
  const schedHolidays = holidays("2026-01-14", "2026-01-26", "2026-03-04");

  // prettier-ignore
  const expected = [
    "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", //  6
    "2026-01-12", "2026-01-13",               "2026-01-15", "2026-01-16", "2026-01-17", // 11
    "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23", "2026-01-24", // 17
                  "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31", // 22
    "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07", // 28
    "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13", "2026-02-14", // 34
    "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", // 40
    "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", // 46
    "2026-03-02", "2026-03-03",               "2026-03-05", "2026-03-06", "2026-03-07", // 51
    "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", // 57
    "2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21", // 63
    "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", // 69
    "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", // 75
    "2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11", // 81
    "2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", // 87
    "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24", "2026-04-25", // 93
    "2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02", // 99
    "2026-05-04",                                                                       // 100
  ];

  it("the fixture itself has 100 dates, none a Sunday", () => {
    expect(expected).toHaveLength(100);
    expect(expected.filter((date) => dayOfWeek(d(date)) === 0)).toEqual([]);
  });

  it("workingDayRange generates exactly the hand-computed dates", () => {
    expect(workingDayRange(disbursement, 100, schedHolidays)).toEqual(expected);
  });

  it("addWorkingDays lands on the hand-computed slot for every n", () => {
    expected.forEach((date, index) => {
      expect(addWorkingDays(disbursement, index + 1, schedHolidays)).toBe(date);
    });
  });

  it("countWorkingDays from disbursement to each slot is that slot's number", () => {
    expected.forEach((date, index) => {
      expect(countWorkingDays(disbursement, d(date), schedHolidays)).toBe(
        index + 1,
      );
    });
  });

  it("the account's last collection day is Monday 4 May 2026", () => {
    expect(addWorkingDays(disbursement, 100, schedHolidays)).toBe("2026-05-04");
  });
});
