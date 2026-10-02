import { describe, expect, it } from "vitest";

import {
  absMoney,
  addMoney,
  changePerMille,
  compareMoney,
  formatCompactCurrency,
  formatPerMille,
  fromPaise,
  isNegativeMoney,
  isZeroMoney,
  perMille,
  subtractMoney,
  sumMoney,
  toPaise,
} from "./money";

describe("toPaise and fromPaise", () => {
  it.each([
    ["0", 0n, "0.00"],
    ["5", 500n, "5.00"],
    ["5.5", 550n, "5.50"],
    ["5.05", 505n, "5.05"],
    ["-5.50", -550n, "-5.50"],
    ["-0.05", -5n, "-0.05"],
    ["123456789012.99", 12345678901299n, "123456789012.99"],
  ])("%s is %s paise and reads back as %s", (text, paise, normalised) => {
    expect(toPaise(text)).toBe(paise);
    expect(fromPaise(paise)).toBe(normalised);
  });

  it("keeps the sign of an amount below one rupee", () => {
    // The unsigned parse gets this wrong: -0.50 is not +0.50 less a rupee.
    expect(toPaise("-0.50")).toBe(-50n);
  });

  it("never writes a negative zero", () => {
    expect(fromPaise(toPaise("-0.00"))).toBe("0.00");
  });
});

describe("arithmetic", () => {
  it("adds and subtracts exactly where floating point would not", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a number.
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(subtractMoney("1000.00", "999.99")).toBe("0.01");
    expect(subtractMoney("250.00", "500.00")).toBe("-250.00");
  });

  it("sums a column — the outstanding across a customer's active accounts", () => {
    // US-022 worked example: three accounts, total labelled as a sum.
    expect(sumMoney(["4200.00", "15000.50", "0.50"])).toBe("19201.00");
    expect(sumMoney([])).toBe("0.00");
  });

  it("reads the sign of a discrepancy", () => {
    const shortBy = subtractMoney("1800.00", "2000.00");
    expect(isNegativeMoney(shortBy)).toBe(true);
    expect(absMoney(shortBy)).toBe("200.00");
    expect(isZeroMoney(subtractMoney("2000.00", "2000"))).toBe(true);
    expect(isZeroMoney("-0.00")).toBe(true);
  });

  it("takes a share in exact paise for a progress bar (US-082)", () => {
    expect(perMille("162750.00", "184300.00")).toBe(883);
    expect(formatPerMille(883)).toBe("88.3%");
    expect(perMille("900.00", "1500.00")).toBe(600);
    // Collected over expected runs past the whole; the caller caps the bar.
    expect(perMille("150.00", "100.00")).toBe(1500);
    expect(formatPerMille(1500)).toBe("150.0%");
    expect(perMille("-20.00", "100.00")).toBe(0);
    // Nothing expected: no share, not 0% and not 100%.
    expect(perMille("0.00", "0.00")).toBeNull();
    expect(perMille("50.00", "0.00")).toBeNull();
  });

  it("measures a month's change against where it started", () => {
    expect(changePerMille("5295950.00", "5186000.00")).toBe(21);
    expect(changePerMille("90.00", "100.00")).toBe(-100);
    // Rounded toward zero, so a fall never reads larger than it was.
    expect(changePerMille("99.99", "100.00")).toBe(0);
    // From nothing, or from below nothing, there is no share.
    expect(changePerMille("50.00", "0.00")).toBeNull();
    expect(changePerMille("50.00", "-10.00")).toBeNull();
  });

  it("says a headline figure in lakhs and crores, rounded half up", () => {
    expect(formatCompactCurrency("5295950.00")).toBe("₹52.96 L");
    expect(formatCompactCurrency("4260000.00")).toBe("₹42.60 L");
    expect(formatCompactCurrency("100000.00")).toBe("₹1.00 L");
    expect(formatCompactCurrency("99999.99")).toBe("₹99,999.99");
    expect(formatCompactCurrency("12500000.00")).toBe("₹1.25 Cr");
    expect(formatCompactCurrency("805.5")).toBe("₹805.50");
    expect(formatCompactCurrency("-120250.00")).toBe("−₹1.20 L");
    // ₹1.505 L sits exactly halfway between two places: it rounds up.
    expect(formatCompactCurrency("150500.00")).toBe("₹1.51 L");
  });

  it("compares amounts", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("10", "10.00")).toBe(0);
    expect(compareMoney("-1", "0")).toBe(-1);
  });
});
