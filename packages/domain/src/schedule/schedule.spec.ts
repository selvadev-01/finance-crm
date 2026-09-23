import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { dayOfWeek, parseCalendarDate } from "../calendar/calendar-date.js";
import {
  addWorkingDays,
  type HolidaySet,
  nextWorkingDay,
  workingDayRange,
} from "../calendar/working-days.js";
import {
  capExpectedAmount,
  generateSchedule,
  type ScheduleSlot,
  scheduleSlotCount,
  targetCompletionDate,
} from "./schedule.js";

const d = parseCalendarDate;
const NONE: HolidaySet = new Set();
const sum = (slots: ScheduleSlot[]) =>
  slots.reduce(
    (total, slot) => total.plus(slot.expectedAmount),
    new Decimal(0),
  );
const amounts = (slots: ScheduleSlot[]) =>
  slots.map((slot) => slot.expectedAmount.toString());

// The PDF's reference account: ₹10,000 / ₹8,500 invested / ₹1,500 profit / ₹100 a day / 100 days.
const DISBURSED = d("2026-01-03"); // Saturday — BR-03's example

describe("BR-04 worked example — exact fit", () => {
  const slots = generateSchedule({
    outstanding: "10000",
    dailyAmount: "100",
    after: DISBURSED,
    frequency: "DAILY" as const,
    holidays: NONE,
    firstSequence: 1,
  });

  it("has ceil(10,000 ÷ 100) = 100 slots", () => {
    expect(slots).toHaveLength(100);
  });

  it("every slot, including the last, expects ₹100", () => {
    expect(new Set(amounts(slots))).toEqual(new Set(["100"]));
  });

  it("sums to exactly ₹10,000", () => {
    expect(sum(slots).toString()).toBe("10000");
  });

  it("numbers slots 1 to 100", () => {
    expect(slots.map((slot) => slot.sequence)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
  });
});

describe("BR-04 worked example — uneven final instalment (US-031)", () => {
  const slots = generateSchedule({
    outstanding: "10000",
    dailyAmount: "150",
    after: DISBURSED,
    frequency: "DAILY" as const,
    holidays: NONE,
    firstSequence: 1,
  });

  it("has ceil(10,000 ÷ 150) = 67 slots", () => {
    expect(slots).toHaveLength(67);
  });

  it("slots 1 to 66 expect ₹150", () => {
    expect(new Set(amounts(slots.slice(0, 66)))).toEqual(new Set(["150"]));
  });

  it("slot 67 expects ₹100, not ₹150", () => {
    expect(slots[66]?.sequence).toBe(67);
    expect(slots[66]?.expectedAmount.toString()).toBe("100");
  });

  it("sums to exactly ₹10,000", () => {
    expect(sum(slots).toString()).toBe("10000");
  });
});

describe("BR-04 correction — the slot count comes from the balance, not the term", () => {
  it("A 10,000, D 150, N 100 passes BR-01 and gives 67 slots, not a final slot of −4,850", () => {
    // N is not an input at all: the old formula A − D × (N − 1) cannot be reached.
    const slots = generateSchedule({
      outstanding: "10000",
      dailyAmount: "150",
      after: DISBURSED,
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 1,
    });
    expect(slots).toHaveLength(67);
    expect(slots.every((slot) => slot.expectedAmount.greaterThan(0))).toBe(
      true,
    );
  });
});

describe("US-030 schedule preview", () => {
  // Holidays from the hand-verified 100-day calendar in working-days.spec.ts.
  const holidays: HolidaySet = new Set(
    ["2026-01-14", "2026-01-26", "2026-03-04"].map(d),
  );
  const slots = generateSchedule({
    outstanding: "10000",
    dailyAmount: "100",
    after: DISBURSED,
    frequency: "DAILY" as const,
    holidays,
    firstSequence: 1,
  });

  it("the first collection date is Monday 5 January", () => {
    expect(slots[0]?.dueDate).toBe("2026-01-05");
    expect(slots[0]?.dueDate).toBe(nextWorkingDay(DISBURSED, holidays));
  });

  it("shows 100 slots summing to exactly 10,000", () => {
    expect(slots).toHaveLength(100);
    expect(sum(slots).toString()).toBe("10000");
  });

  it("no slot falls on a Sunday or a declared holiday", () => {
    for (const slot of slots) {
      expect(dayOfWeek(slot.dueDate)).not.toBe(0);
      expect(holidays.has(slot.dueDate)).toBe(false);
    }
  });

  it("the last slot is the hand-computed Monday 4 May, which is the target completion date", () => {
    expect(slots[99]?.dueDate).toBe("2026-05-04");
    expect(
      targetCompletionDate({
        outstanding: "10000",
        dailyAmount: "100",
        after: DISBURSED,
        frequency: "DAILY" as const,
        holidays,
      }),
    ).toBe("2026-05-04");
  });
});

describe("BR-06 worked examples — regenerating the tail after day 51", () => {
  const day = (n: number) => addWorkingDays(DISBURSED, n, NONE);
  const originalTarget = day(100);

  const tailAfterDay51 = (outstanding: string) => ({
    slots: generateSchedule({
      outstanding,
      dailyAmount: "100",
      after: day(51),
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 52,
    }),
    target: targetCompletionDate({
      outstanding,
      dailyAmount: "100",
      after: day(51),
      frequency: "DAILY" as const,
      holidays: NONE,
    }),
  });

  it("the original target is day 100", () => {
    expect(
      targetCompletionDate({
        outstanding: "10000",
        dailyAmount: "100",
        after: DISBURSED,
        frequency: "DAILY" as const,
        holidays: NONE,
      }),
    ).toBe(originalTarget);
  });

  describe("shortfall: ₹80 on day 51, outstanding ₹4,920", () => {
    const { slots, target } = tailAfterDay51("4920");

    it("needs ceil(4,920 ÷ 100) = 50 more days", () => {
      expect(slots).toHaveLength(50);
      expect(scheduleSlotCount("4920", "100")).toBe(50);
    });

    it("the tail continues from slot 52 to slot 101", () => {
      expect(slots[0]?.sequence).toBe(52);
      expect(slots[49]?.sequence).toBe(101);
    });

    it("the target moves out one working day, to day 101", () => {
      expect(target).toBe(day(101));
      expect(target).toBe(nextWorkingDay(originalTarget, NONE));
    });

    it("the daily amount does not rise to catch up — the last slot takes the ₹20 remainder (BR-10)", () => {
      expect(new Set(amounts(slots.slice(0, 49)))).toEqual(new Set(["100"]));
      expect(slots[49]?.expectedAmount.toString()).toBe("20");
      expect(sum(slots).toString()).toBe("4920");
    });
  });

  describe("overpayment: ₹120 on day 51, outstanding ₹4,880", () => {
    const { slots, target } = tailAfterDay51("4880");

    it("needs ceil(4,880 ÷ 100) = 49 more days, so the target stays day 100", () => {
      expect(slots).toHaveLength(49);
      expect(target).toBe(originalTarget);
    });

    it("tomorrow still expects ₹100 — the surplus is not spread across days (BR-10)", () => {
      expect(slots[0]?.expectedAmount.toString()).toBe("100");
      expect(slots[48]?.expectedAmount.toString()).toBe("80");
    });
  });

  it("a second ₹120 day still leaves the target on day 100 — ₹40 surplus is not a whole day", () => {
    // Outstanding 4,760 after day 52: ceil(47.6) = 48 more days → day 100.
    expect(
      targetCompletionDate({
        outstanding: "4760",
        dailyAmount: "100",
        after: day(52),
        frequency: "DAILY" as const,
        holidays: NONE,
      }),
    ).toBe(originalTarget);
  });

  it("five ₹120 days — ₹100 of surplus — pull the target in to day 99", () => {
    // Outstanding 10,000 − 50 × 100 − 5 × 120 = 4,400 after day 55: 44 more days → day 99.
    expect(
      targetCompletionDate({
        outstanding: "4400",
        dailyAmount: "100",
        after: day(55),
        frequency: "DAILY" as const,
        holidays: NONE,
      }),
    ).toBe(day(99));
  });
});

describe("US-030a — a mid-term account schedules identically to a day-one account", () => {
  it("the same outstanding, daily amount and anchor date give the same tail and target", () => {
    const anchor = d("2026-08-14");
    const midTerm = {
      outstanding: "5300",
      dailyAmount: "100",
      after: anchor,
      frequency: "DAILY" as const,
      holidays: NONE,
    };
    const dayOne = {
      outstanding: new Decimal("10000").minus("4700"),
      dailyAmount: new Decimal("100"),
      after: anchor,
      frequency: "DAILY" as const,
      holidays: NONE,
    };
    expect(generateSchedule({ ...midTerm, firstSequence: 48 })).toEqual(
      generateSchedule({ ...dayOne, firstSequence: 48 }),
    );
    expect(targetCompletionDate(midTerm)).toBe(targetCompletionDate(dayOne));
  });

  it("an entered balance of 4,580 is scheduled as outstanding 5,420, not 5,300", () => {
    const slots = generateSchedule({
      outstanding: new Decimal("10000").minus("4580"),
      dailyAmount: "100",
      after: d("2026-08-14"),
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 1,
    });
    expect(slots).toHaveLength(55);
    expect(sum(slots).toString()).toBe("5420");
    expect(slots[54]?.expectedAmount.toString()).toBe("20");
  });
});

describe("a holiday inside the schedule", () => {
  it("pushes every later slot to the next working day without changing any amount", () => {
    const base = {
      outstanding: "500",
      dailyAmount: "100",
      after: d("2026-01-13"),
      firstSequence: 1,
    };
    const without = generateSchedule({
      ...base,
      frequency: "DAILY",
      holidays: NONE,
    });
    const withHoliday = generateSchedule({
      ...base,
      frequency: "DAILY" as const,
      holidays: new Set([d("2026-01-15")]),
    });
    expect(without.map((slot) => slot.dueDate)).toEqual([
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
      "2026-01-17",
      "2026-01-19",
    ]);
    expect(withHoliday.map((slot) => slot.dueDate)).toEqual([
      "2026-01-14",
      "2026-01-16",
      "2026-01-17",
      "2026-01-19",
      "2026-01-20",
    ]);
    expect(amounts(withHoliday)).toEqual(amounts(without));
  });
});

describe("nothing outstanding", () => {
  it.each(["0", "-20"])(
    "outstanding %s produces no slots and no target date (BR-05)",
    (outstanding) => {
      const input = {
        outstanding,
        dailyAmount: "100",
        after: DISBURSED,
        frequency: "DAILY" as const,
        holidays: NONE,
      };
      expect(generateSchedule({ ...input, firstSequence: 1 })).toEqual([]);
      expect(scheduleSlotCount(outstanding, "100")).toBe(0);
      expect(targetCompletionDate(input)).toBeNull();
    },
  );
});

describe("paise-level amounts", () => {
  it("an outstanding of ₹100.01 needs a second slot for the one paisa", () => {
    const slots = generateSchedule({
      outstanding: "100.01",
      dailyAmount: "100",
      after: DISBURSED,
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 1,
    });
    expect(amounts(slots)).toEqual(["100", "0.01"]);
  });

  it("a daily amount with paise divides without drift", () => {
    const slots = generateSchedule({
      outstanding: "1000",
      dailyAmount: "33.33",
      after: DISBURSED,
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 1,
    });
    expect(slots).toHaveLength(31);
    expect(slots[30]?.expectedAmount.toString()).toBe("0.1");
    expect(sum(slots).toString()).toBe("1000");
  });

  it("due dates are exactly the working-day range after the anchor", () => {
    const slots = generateSchedule({
      outstanding: "10000",
      dailyAmount: "150",
      after: DISBURSED,
      frequency: "DAILY" as const,
      holidays: NONE,
      firstSequence: 1,
    });
    expect(slots.map((slot) => slot.dueDate)).toEqual(
      workingDayRange(DISBURSED, 67, NONE),
    );
  });
});

describe("capExpectedAmount (BR-07)", () => {
  it.each([
    ["the daily amount while outstanding exceeds it", "100", "5000", "100"],
    ["the outstanding when it is below the daily amount", "100", "50", "50"],
    ["the daily amount when they are equal", "100", "100", "100"],
    ["zero once nothing is outstanding", "100", "0", "0"],
    ["zero after an overpayment", "100", "-20", "0"],
  ])("is %s", (_label, daily, outstanding, expected) => {
    expect(capExpectedAmount(daily, outstanding).toString()).toBe(expected);
  });

  it("BR-07 worked example: ₹50 left at ₹100 a day expects ₹50", () => {
    expect(capExpectedAmount("100", "50").toString()).toBe("50");
  });
});

describe("invalid input is refused, not coerced", () => {
  const valid = {
    outstanding: "10000",
    dailyAmount: "100",
    after: DISBURSED,
    frequency: "DAILY" as const,
    holidays: NONE,
    firstSequence: 1,
  };

  it.each(["0", "-100"])("dailyAmount %s", (dailyAmount) => {
    expect(() => generateSchedule({ ...valid, dailyAmount })).toThrow(
      /dailyAmount/,
    );
    expect(() => capExpectedAmount(dailyAmount, "100")).toThrow(RangeError);
  });

  it.each([
    ["dailyAmount", { dailyAmount: "100.005" }],
    ["outstanding", { outstanding: "10000.001" }],
    ["outstanding", { outstanding: "abc" }],
  ])("%s with an invalid value", (field, override) => {
    expect(() => generateSchedule({ ...valid, ...override })).toThrow(
      new RegExp(field),
    );
  });

  it.each([0, -1, 1.5, Number.NaN])("firstSequence %s", (firstSequence) => {
    expect(() => generateSchedule({ ...valid, firstSequence })).toThrow(
      /firstSequence/,
    );
  });
});

describe("BR-04 at a weekly cadence — ₹10,000 at ₹500 a week", () => {
  // Disbursed Wednesday 23 September 2026. N is 20 weeks, and 500 × 20 = 10,000
  // clears it exactly, so the maths is BR-04's unchanged: only the dates move.
  const slots = generateSchedule({
    outstanding: "10000",
    dailyAmount: "500",
    after: d("2026-09-23"),
    frequency: "WEEKLY",
    holidays: NONE,
    firstSequence: 1,
  });

  it("has ceil(10,000 ÷ 500) = 20 slots of ₹500", () => {
    expect(slots).toHaveLength(20);
    expect(sum(slots).toString()).toBe("10000");
    expect(new Set(amounts(slots))).toEqual(new Set(["500"]));
  });

  it("collects every Wednesday, starting a week after day 0", () => {
    expect(slots.slice(0, 3).map((slot) => slot.dueDate)).toEqual([
      "2026-09-30",
      "2026-10-07",
      "2026-10-14",
    ]);
    expect(slots.every((slot) => dayOfWeek(slot.dueDate) === 3)).toBe(true);
  });

  it("ends on the twentieth Wednesday, which is the target completion date", () => {
    expect(slots.at(-1)?.dueDate).toBe("2027-02-10");
    expect(
      targetCompletionDate({
        outstanding: "10000",
        dailyAmount: "500",
        after: d("2026-09-23"),
        frequency: "WEEKLY",
        holidays: NONE,
      }),
    ).toBe("2027-02-10");
  });
});

describe("BR-07's uneven last slot is the same at every cadence", () => {
  // ₹10,000 at ₹3,000 a month: three full instalments and ₹1,000 left.
  const slots = generateSchedule({
    outstanding: "10000",
    dailyAmount: "3000",
    after: d("2026-09-23"),
    frequency: "MONTHLY",
    holidays: NONE,
    firstSequence: 1,
  });

  it("expects the remainder on the last month, so the slots sum to exactly A", () => {
    expect(amounts(slots)).toEqual(["3000", "3000", "3000", "1000"]);
    expect(sum(slots).toString()).toBe("10000");
  });

  it("falls on the 23rd of each month after day 0", () => {
    expect(slots.map((slot) => slot.dueDate)).toEqual([
      "2026-10-23",
      "2026-11-23",
      "2026-12-23",
      "2027-01-23",
    ]);
  });
});
