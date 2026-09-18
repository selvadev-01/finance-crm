import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseCalendarDate } from "../calendar/calendar-date.js";
import {
  addWorkingDays,
  countWorkingDays,
  type HolidaySet,
  nextWorkingDay,
} from "../calendar/working-days.js";
import { type MidTermSlot, planMidTermSchedule } from "./mid-term.js";
import { generateSchedule } from "./schedule.js";

const d = parseCalendarDate;
const NONE: HolidaySet = new Set();
const total = (slots: MidTermSlot[]) =>
  slots.reduce((sum, slot) => sum.plus(slot.expectedAmount), new Decimal(0));
const withStatus = (slots: MidTermSlot[], status: MidTermSlot["status"]) =>
  slots.filter((slot) => slot.status === status);

describe("US-030a worked example — started 1 July, paid 4,700 of 10,000", () => {
  const disbursed = d("2026-07-01");
  const entered = d("2026-08-14");
  const plan = planMidTermSchedule({
    accountAmount: "10000",
    dailyAmount: "100",
    disbursementDate: disbursed,
    enteredOn: entered,
    collectedToDate: "4700",
    holidays: NONE,
  });

  it("is outstanding 5,300", () => {
    expect(plan.outstanding.toString()).toBe("5300");
  });

  it("marks the first 47 slots collected, on their original dates from 2 July", () => {
    const collected = withStatus(plan.slots, "COLLECTED");
    expect(collected).toHaveLength(47);
    expect(collected[0]).toMatchObject({ sequence: 1, dueDate: "2026-07-02" });
    expect(withStatus(plan.slots, "PARTIAL")).toEqual([]);
  });

  it("schedules the 5,300 as slots 48–100 from the next working day after entry", () => {
    const tail = withStatus(plan.slots, "PENDING");
    expect(tail).toHaveLength(53);
    expect(tail[0]).toMatchObject({
      sequence: 48,
      dueDate: nextWorkingDay(entered, NONE),
    });
    expect(total(tail).toString()).toBe("5300");
    expect(plan.targetCompletionDate).toBe(addWorkingDays(entered, 53, NONE));
  });

  it("keeps the first collection date of the original term (BR-03)", () => {
    expect(plan.firstCollectionDate).toBe("2026-07-02");
  });

  it("only 38 working days were due by 14 August, so 4,700 paid is ahead and nothing is behind", () => {
    expect(countWorkingDays(disbursed, entered, NONE)).toBe(38);
    expect(plan.amountBehind.toString()).toBe("0");
  });

  it("entered on 25 August instead — 47 days due — it is exactly on time", () => {
    const onTime = planMidTermSchedule({
      accountAmount: "10000",
      dailyAmount: "100",
      disbursementDate: disbursed,
      enteredOn: d("2026-08-25"),
      collectedToDate: "4700",
      holidays: NONE,
    });
    expect(countWorkingDays(disbursed, d("2026-08-25"), NONE)).toBe(47);
    expect(onTime.amountBehind.toString()).toBe("0");
    const behind = planMidTermSchedule({
      accountAmount: "10000",
      dailyAmount: "100",
      disbursementDate: disbursed,
      enteredOn: d("2026-08-25"),
      collectedToDate: "4580",
      holidays: NONE,
    });
    expect(behind.amountBehind.toString()).toBe("120");
  });
});

describe("US-030a — collected amount is entered, never inferred", () => {
  it("4,580 paid (six underpayments) is outstanding 5,420: 45 collected, slot 46 partial, 55 pending", () => {
    const plan = planMidTermSchedule({
      accountAmount: "10000",
      dailyAmount: "100",
      disbursementDate: d("2026-07-01"),
      enteredOn: d("2026-08-14"),
      collectedToDate: "4580",
      holidays: NONE,
    });
    expect(plan.outstanding.toString()).toBe("5420");
    expect(withStatus(plan.slots, "COLLECTED")).toHaveLength(45);
    expect(withStatus(plan.slots, "PARTIAL")).toEqual([
      expect.objectContaining({ sequence: 46 }),
    ]);
    const tail = withStatus(plan.slots, "PENDING");
    expect(tail).toHaveLength(55);
    expect(tail[0]!.sequence).toBe(47);
    expect(total(tail).toString()).toBe("5420");
  });
});

describe("a hand-checked week — disbursed Saturday 3 January, entered Saturday 10 January", () => {
  const base = {
    accountAmount: "10000",
    dailyAmount: "100",
    disbursementDate: d("2026-01-03"),
    enteredOn: d("2026-01-10"),
    holidays: NONE,
  };

  it("450 paid against six days due (5–10 Jan): behind 150, four collected, one partial, tail from Monday 12", () => {
    const plan = planMidTermSchedule({ ...base, collectedToDate: "450" });
    expect(plan.amountBehind.toString()).toBe("150");
    expect(
      withStatus(plan.slots, "COLLECTED").map((slot) => slot.dueDate),
    ).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
    expect(withStatus(plan.slots, "PARTIAL")).toEqual([
      expect.objectContaining({ sequence: 5, dueDate: "2026-01-09" }),
    ]);
    const tail = withStatus(plan.slots, "PENDING");
    expect(tail[0]).toMatchObject({ sequence: 6, dueDate: "2026-01-12" });
    expect(tail).toHaveLength(96);
  });

  it("nothing paid yet: no collected slots, the whole 10,000 from Monday 12, behind 600", () => {
    const plan = planMidTermSchedule({ ...base, collectedToDate: "0" });
    expect(plan.slots.every((slot) => slot.status === "PENDING")).toBe(true);
    expect(plan.slots[0]).toMatchObject({ sequence: 1, dueDate: "2026-01-12" });
    expect(plan.slots).toHaveLength(100);
    expect(plan.amountBehind.toString()).toBe("600");
    expect(plan.firstCollectionDate).toBe("2026-01-05");
  });

  it("paid ahead: not behind, and the tail still starts the day after entry", () => {
    const plan = planMidTermSchedule({ ...base, collectedToDate: "1000" });
    expect(plan.amountBehind.toString()).toBe("0");
    expect(withStatus(plan.slots, "COLLECTED")).toHaveLength(10);
    expect(withStatus(plan.slots, "PENDING")[0]).toMatchObject({
      sequence: 11,
      dueDate: "2026-01-12",
    });
  });

  it("refuses a disbursement on or after the entry day, and a collected amount outside 0…A", () => {
    expect(() =>
      planMidTermSchedule({
        ...base,
        enteredOn: d("2026-01-03"),
        collectedToDate: "0",
      }),
    ).toThrow(RangeError);
    expect(() =>
      planMidTermSchedule({ ...base, collectedToDate: "10000" }),
    ).toThrow(RangeError);
    expect(() =>
      planMidTermSchedule({ ...base, collectedToDate: "-1" }),
    ).toThrow(RangeError);
  });
});

describe("release gate 6 — the tail is exactly a day-one account's regenerated tail", () => {
  it("for any amount, daily amount and collected total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 2_000_000 }), // A in paise … ×100 below
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (rupees, dailyShare, share) => {
          const accountAmount = new Decimal(rupees);
          const dailyAmount = Decimal.max(
            1,
            accountAmount.times(dailyShare).dividedBy(100).floor(),
          );
          const collected = accountAmount.times(share).floor();
          const entered = d("2026-03-16");
          const plan = planMidTermSchedule({
            accountAmount,
            dailyAmount,
            disbursementDate: d("2026-01-03"),
            enteredOn: entered,
            collectedToDate: collected,
            holidays: NONE,
          });
          const paid = plan.slots.filter((slot) => slot.status !== "PENDING");
          const tail = plan.slots.filter((slot) => slot.status === "PENDING");
          const dayOne = generateSchedule({
            outstanding: accountAmount.minus(collected),
            dailyAmount,
            after: entered,
            holidays: NONE,
            firstSequence: paid.length + 1,
          });
          expect(tail.map(({ status: _status, ...slot }) => slot)).toEqual(
            dayOne,
          );
          // What the paid slots stand for is exactly the collected amount.
          const fullyPaid = paid
            .filter((slot) => slot.status === "COLLECTED")
            .reduce(
              (sum, slot) => sum.plus(slot.expectedAmount),
              new Decimal(0),
            );
          const partial = paid.find((slot) => slot.status === "PARTIAL");
          expect(fullyPaid.lessThanOrEqualTo(collected)).toBe(true);
          if (partial) {
            expect(
              collected.minus(fullyPaid).lessThan(partial.expectedAmount),
            ).toBe(true);
          } else {
            expect(fullyPaid.equals(collected)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
