import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { capExpectedAmount } from "../schedule/schedule.js";
import { type Classification, classifyCollection } from "./variance.js";

const classify = (amount: string, expectedAmount: string) => {
  const result = classifyCollection({ amount, expectedAmount });
  return {
    variance: result.variance.toString(),
    classification: result.classification,
  };
};

describe("BR-08 / US-041 worked examples", () => {
  it("₹100 against ₹100 is CORRECT with variance 0", () => {
    expect(classify("100", "100")).toEqual({
      variance: "0",
      classification: "CORRECT",
    });
  });

  it("₹80 against ₹100 is LOW with variance −20", () => {
    expect(classify("80", "100")).toEqual({
      variance: "-20",
      classification: "LOW",
    });
  });

  it("₹120 against ₹100 is EXTRA with variance +20", () => {
    expect(classify("120", "100")).toEqual({
      variance: "20",
      classification: "EXTRA",
    });
  });

  it("a visit where the customer paid nothing is NO_PAYMENT with variance −100", () => {
    expect(classify("0", "100")).toEqual({
      variance: "-100",
      classification: "NO_PAYMENT",
    });
  });

  it("BR-07: ₹80 collected against a capped expectation of ₹80 completes with variance 0", () => {
    const expectedAmount = capExpectedAmount("100", "80");
    expect(
      classifyCollection({ amount: "80", expectedAmount }).classification,
    ).toBe("CORRECT");
  });
});

describe("exact match — no tolerance band", () => {
  it.each([
    ["99.99", "100", "-0.01", "LOW"],
    ["100.01", "100", "0.01", "EXTRA"],
    ["0.01", "100", "-99.99", "LOW"],
    ["100.00", "100", "0", "CORRECT"],
    ["150.5", "150.50", "0", "CORRECT"],
  ])(
    "₹%s against ₹%s is variance %s, %s",
    (amount, expected, variance, classification) => {
      expect(classify(amount, expected)).toEqual({ variance, classification });
    },
  );
});

describe("a zero amount is always NO_PAYMENT", () => {
  it("even when nothing was expected, where variance is also 0", () => {
    expect(classify("0", "0")).toEqual({
      variance: "0",
      classification: "NO_PAYMENT",
    });
  });

  it("an amount paid against a zero expectation is EXTRA", () => {
    expect(classify("50", "0").classification).toBe("EXTRA");
  });
});

describe("invalid input is refused", () => {
  it("a negative amount, which only an ADJUSTMENT may carry (BR-14)", () => {
    expect(() => classify("-20", "100")).toThrow(/ADJUSTMENT/);
  });

  it("a negative expected amount", () => {
    expect(() => classify("100", "-1")).toThrow(/expectedAmount/);
  });

  it.each([
    ["amount", "80.001", "100"],
    ["expectedAmount", "80", "abc"],
  ])("%s that is not NUMERIC(14,2)", (field, amount, expected) => {
    expect(() => classify(amount, expected)).toThrow(new RegExp(field));
  });
});

/**
 * `collection_classification_check`, transcribed from
 * `20260913094000_constraints_collection/migration.sql` for an ORIGINAL row.
 * If this test and the migration disagree, one of them has drifted.
 */
function databaseAccepts(
  classification: Classification,
  amount: Decimal,
  variance: Decimal,
): boolean {
  switch (classification) {
    case "NO_PAYMENT":
      return amount.isZero();
    case "CORRECT":
      return amount.greaterThan(0) && variance.isZero();
    case "LOW":
      return amount.greaterThan(0) && variance.lessThan(0);
    case "EXTRA":
      return amount.greaterThan(0) && variance.greaterThan(0);
  }
}

const ALL: Classification[] = ["CORRECT", "LOW", "EXTRA", "NO_PAYMENT"];

describe("agreement with the database constraint", () => {
  const paise = fc.oneof(
    fc.integer({ min: 0, max: 100_000_000 }),
    fc.constantFrom(0, 1, 9_999, 10_000, 10_001),
  );
  const money = paise.map((p) => new Decimal(p).dividedBy(100));

  it("the result satisfies collection_classification_check and collection_variance_derivation_check", () => {
    fc.assert(
      fc.property(money, money, (amount, expectedAmount) => {
        const { variance, classification } = classifyCollection({
          amount,
          expectedAmount,
        });
        expect(variance.equals(amount.minus(expectedAmount))).toBe(true);
        expect(databaseAccepts(classification, amount, variance)).toBe(true);
      }),
    );
  });

  it("for every valid row the constraint accepts exactly one classification, so there is no choice to get wrong", () => {
    fc.assert(
      fc.property(money, money, (amount, expectedAmount) => {
        const variance = amount.minus(expectedAmount);
        const accepted = ALL.filter((c) =>
          databaseAccepts(c, amount, variance),
        );
        expect(accepted).toHaveLength(1);
      }),
    );
  });
});
