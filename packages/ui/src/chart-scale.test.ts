import { describe, expect, it } from "vitest";

import {
  axisTicks,
  fromPaise,
  monotonePath,
  niceCeiling,
  plotFraction,
  toPaise,
} from "./chart-scale";

describe("chart scale", () => {
  it("reads money strings as exact signed paise and writes them back", () => {
    expect(toPaise("1350.00")).toBe(135000n);
    expect(toPaise("12.5")).toBe(1250n);
    expect(toPaise("-50.00")).toBe(-5000n);
    expect(fromPaise(-5000n)).toBe("-50.00");
    expect(() => toPaise("1.005")).toThrow();
    expect(() => toPaise("1e3")).toThrow();
  });

  it("rounds the axis up to 1, 2, 2.5 or 5 × 10ⁿ rupees", () => {
    expect(niceCeiling(toPaise("1400.00"))).toBe(toPaise("2000.00"));
    expect(niceCeiling(toPaise("2000.00"))).toBe(toPaise("2000.00"));
    expect(niceCeiling(toPaise("2100.00"))).toBe(toPaise("2500.00"));
    expect(niceCeiling(toPaise("184300.00"))).toBe(toPaise("200000.00"));
    expect(niceCeiling(toPaise("3.20"))).toBe(toPaise("5.00"));
    // Nothing due: the axis still has a height.
    expect(niceCeiling(0n)).toBe(toPaise("1.00"));
  });

  it("gives evenly spaced ticks as decimal strings, never numbers", () => {
    expect(axisTicks(toPaise("2000.00"))).toEqual([
      "0.00",
      "500.00",
      "1000.00",
      "1500.00",
      "2000.00",
    ]);
    expect(axisTicks(toPaise("2.50"))).toEqual([
      "0.00",
      "0.62",
      "1.25",
      "1.87",
      "2.50",
    ]);
  });

  it("turns an amount into a share of the plot, with a negative day on the baseline", () => {
    const ceiling = toPaise("2000.00");
    expect(plotFraction(toPaise("1350.00"), ceiling)).toBe(0.675);
    expect(plotFraction(toPaise("-50.00"), ceiling)).toBe(0);
    expect(plotFraction(toPaise("2500.00"), ceiling)).toBe(1);
    expect(plotFraction(toPaise("10.00"), 0n)).toBe(0);
  });

  it("draws a curve that stays on the baseline between flat days", () => {
    const path = monotonePath([
      { x: 0, y: 200 },
      { x: 100, y: 200 },
      { x: 200, y: 50 },
      { x: 300, y: 200 },
    ]);
    const ys = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) =>
      Number(match[2]),
    );
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(50);
    expect(path.startsWith("M0,200")).toBe(true);
    expect(monotonePath([])).toBe("");
  });
});
