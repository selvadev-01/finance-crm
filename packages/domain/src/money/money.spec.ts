import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import { toMoney, toPaise } from "./money.js";

describe("toMoney (BR-11)", () => {
  it.each(["10000", "10000.00", "8500.5", "0.01", "-4850", "999999999999.99"])(
    "accepts %s",
    (value) => {
      expect(toMoney(value).equals(new Decimal(value))).toBe(true);
    },
  );

  it("accepts a Decimal", () => {
    expect(toMoney(new Decimal("150")).toString()).toBe("150");
  });

  it.each([
    ["three decimal places", "100.005"],
    ["beyond NUMERIC(14,2)", "1000000000000"],
    ["infinity", "Infinity"],
    ["NaN", "NaN"],
    ["not a number at all", "one hundred"],
    ["empty", ""],
  ])("rejects %s rather than rounding it", (_label, value) => {
    expect(() => toMoney(value)).toThrow(RangeError);
  });

  it("names the field in the error", () => {
    expect(() => toMoney("1.234", "dailyAmount")).toThrow(/dailyAmount/);
  });
});

describe("toPaise", () => {
  it.each([
    ["10000", 1_000_000n],
    ["0.01", 1n],
    ["150.5", 15_050n],
    ["-20", -2_000n],
    ["999999999999.99", 99_999_999_999_999n],
  ])("%s is %s paise", (value, expected) => {
    expect(toPaise(toMoney(value))).toBe(expected);
  });
});
