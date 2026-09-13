import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  profitForCollection,
  recognisedProfit,
  unearnedProfit,
} from "./profit.js";

// The PDF's reference account: ₹10,000 / ₹8,500 invested / ₹1,500 profit / ₹100 a day.
const PDF = { accountAmount: "10000", profitAmount: "1500" };
// Uneven: ₹9,999 / ₹8,500 invested / ₹1,499 profit. P/A = 0.14991499…
const UNEVEN = { accountAmount: "9999", profitAmount: "1499" };

/**
 * Independent oracle: exact decimal arithmetic at 60 significant digits and
 * decimal.js's own ROUND_HALF_UP — a different method from the implementation's
 * BigInt paise, so agreement means something.
 */
const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const oracle = (
  accountAmount: string,
  profitAmount: string,
  collected: string,
) =>
  new Exact(collected)
    .times(profitAmount)
    .dividedBy(accountAmount)
    .toDecimalPlaces(2, Exact.ROUND_HALF_UP)
    .toString();

const post = (
  terms: typeof PDF,
  collectedBefore: string,
  amount: string,
): string =>
  profitForCollection({ ...terms, collectedBefore, amount }).toString();

describe("BR-18 worked examples — ₹10,000 / ₹8,500 / ₹1,500", () => {
  it("at disbursement nothing is earned and ₹1,500 is unearned", () => {
    expect(recognisedProfit({ ...PDF, collected: "0" }).toString()).toBe("0");
    expect(unearnedProfit({ ...PDF, collected: "0" }).toString()).toBe("1500");
  });

  it("a collection of ₹100 recognises ₹15.00 (P / A = 15%)", () => {
    expect(post(PDF, "0", "100")).toBe("15");
  });

  it("100 collections of ₹100 recognise exactly ₹1,500 and leave nothing unearned", () => {
    let earned = new Decimal(0);
    for (let day = 0; day < 100; day += 1) {
      earned = earned.plus(
        profitForCollection({
          ...PDF,
          collectedBefore: String(day * 100),
          amount: "100",
        }),
      );
    }
    expect(earned.toString()).toBe("1500");
    expect(unearnedProfit({ ...PDF, collected: "10000" }).toString()).toBe("0");
  });

  it("shortfall: ₹80 recognises ₹12.00", () => {
    expect(post(PDF, "5000", "80")).toBe("12");
  });

  it("overpayment: ₹120 recognises ₹18.00", () => {
    expect(post(PDF, "5000", "120")).toBe("18");
  });

  it("no payment recognises nothing", () => {
    expect(post(PDF, "5000", "0")).toBe("0");
  });

  it("a half-collected account shows half its profit", () => {
    expect(recognisedProfit({ ...PDF, collected: "5000" }).toString()).toBe(
      "750",
    );
  });

  it("a reversal of ₹100 un-recognises ₹15.00", () => {
    expect(post(PDF, "5000", "-100")).toBe("-15");
  });
});

describe("rounding is on the running total (decision recorded in M09)", () => {
  // Hand-computed: 100 × 1499 / 9999 = 14.9914… → 14.99; 400 × … = 59.9659… → 59.97.
  it("the first three ₹100 collections each post ₹14.99", () => {
    expect(post(UNEVEN, "0", "100")).toBe("14.99");
    expect(post(UNEVEN, "100", "100")).toBe("14.99");
    expect(post(UNEVEN, "200", "100")).toBe("14.99");
  });

  it("the fourth posts ₹15.00, catching the running total up to ₹59.97", () => {
    expect(post(UNEVEN, "300", "100")).toBe("15");
    expect(recognisedProfit({ ...UNEVEN, collected: "400" }).toString()).toBe(
      "59.97",
    );
  });

  it("the final ₹99 posts ₹14.84 and earned profit lands on exactly ₹1,499", () => {
    expect(post(UNEVEN, "9900", "99")).toBe("14.84");
    expect(recognisedProfit({ ...UNEVEN, collected: "9999" }).toString()).toBe(
      "1499",
    );
    expect(unearnedProfit({ ...UNEVEN, collected: "9999" }).toString()).toBe(
      "0",
    );
  });

  it("the whole uneven account posts ₹15.00 on fifteen days and sums to exactly ₹1,499", () => {
    const posted: string[] = [];
    for (let day = 0; day < 100; day += 1) {
      const before = day * 100;
      const amount = Math.min(100, 9999 - before);
      posted.push(post(UNEVEN, String(before), String(amount)));
    }
    const total = posted.reduce((sum, p) => sum.plus(p), new Decimal(0));
    expect(total.toString()).toBe("1499");
    expect(posted.filter((p) => p === "15")).toHaveLength(15);
  });

  it("rounds half up, not to even: ₹0.30 at 15% is ₹0.045 → ₹0.05", () => {
    expect(recognisedProfit({ ...PDF, collected: "0.3" }).toString()).toBe(
      "0.05",
    );
  });

  it("a full reversal need not mirror its original to the paisa", () => {
    // Collected ₹400 → ₹59.97. The 4th ₹100 posted +15.00; reversing the 1st
    // (posted +14.99) from ₹400 posts −15.00. The ledger still balances.
    expect(post(UNEVEN, "0", "100")).toBe("14.99");
    expect(post(UNEVEN, "400", "-100")).toBe("-15");
  });
});

describe("US-030a mid-term catch-up posting", () => {
  it("collected to date ₹4,700 recognises ₹705", () => {
    expect(post(PDF, "0", "4700")).toBe("705");
  });

  it("an entered ₹4,580 recognises ₹687, not the ₹705 an inferred balance would", () => {
    expect(post(PDF, "0", "4580")).toBe("687");
  });

  it("one catch-up posting earns exactly what a day-one account's 46 collections earned (release gate 6)", () => {
    // Day one: 45 collections of ₹100, then ₹80 — the same ₹4,580, paid over time.
    let dayOne = new Decimal(0);
    let before = 0;
    for (const amount of [...Array<number>(45).fill(100), 80]) {
      dayOne = dayOne.plus(post(PDF, String(before), String(amount)));
      before += amount;
    }
    expect(post(PDF, "0", "4580")).toBe(dayOne.toString());
  });

  it("an uneven mid-term catch-up matches the day-one path to the paisa", () => {
    let dayOne = new Decimal(0);
    for (let day = 0; day < 47; day += 1) {
      dayOne = dayOne.plus(post(UNEVEN, String(day * 100), "100"));
    }
    expect(post(UNEVEN, "0", "4700")).toBe(dayOne.toString());
  });
});

describe("invalid input is refused", () => {
  it("a collection that would take collected above the account amount (US-041)", () => {
    expect(() => post(PDF, "9950", "100")).toThrow(/cannot exceed/);
  });

  it("an adjustment that would take collected below zero", () => {
    expect(() => post(PDF, "50", "-100")).toThrow(RangeError);
  });

  it.each([
    ["profit equal to the account amount", "10000", "10000"],
    ["zero profit", "10000", "0"],
    ["negative profit", "10000", "-1"],
    ["zero account amount", "0", "0"],
  ])("%s (BR-01)", (_label, accountAmount, profitAmount) => {
    expect(() =>
      recognisedProfit({ accountAmount, profitAmount, collected: "0" }),
    ).toThrow(RangeError);
  });

  it.each([
    ["collected", { collected: "-1" }],
    ["collected", { collected: "10000.01" }],
    ["collected", { collected: "100.005" }],
  ])("%s out of range or not NUMERIC(14,2)", (field, override) => {
    expect(() => recognisedProfit({ ...PDF, ...override })).toThrow(
      new RegExp(field),
    );
  });
});

describe("properties", () => {
  const paise = (min: number, max: number) =>
    fc
      .integer({ min, max })
      .map((p) => new Decimal(p).dividedBy(100).toString());

  /** A = up to ₹50 lakh; P strictly between 0 and A. */
  const terms = fc.integer({ min: 2, max: 500_000_000 }).chain((accountPaise) =>
    fc.record({
      accountAmount: fc.constant(
        new Decimal(accountPaise).dividedBy(100).toString(),
      ),
      profitAmount: paise(1, accountPaise - 1),
      accountPaise: fc.constant(accountPaise),
    }),
  );

  it("recognised profit matches an exact-decimal half-up oracle", () => {
    fc.assert(
      fc.property(
        terms.chain((t) => fc.tuple(fc.constant(t), paise(0, t.accountPaise))),
        ([t, collected]) => {
          expect(recognisedProfit({ ...t, collected }).toString()).toBe(
            oracle(t.accountAmount, t.profitAmount, collected),
          );
        },
      ),
    );
  });

  /**
   * Any sequence of collections and adjustments that ends fully collected:
   * posted profit sums to exactly P, and at every step the running total is
   * the rounded exact figure — within half a paisa, never accumulating.
   */
  it("any path of collections and adjustments to full collection earns exactly P", () => {
    const path = terms.chain((t) =>
      fc.tuple(
        fc.constant(t),
        fc.array(fc.integer({ min: 0, max: t.accountPaise }), {
          maxLength: 60,
        }),
      ),
    );
    fc.assert(
      fc.property(path, ([t, checkpoints]) => {
        // Visiting arbitrary balances in order means steps up and down — collections and adjustments.
        const balances = [...checkpoints, t.accountPaise];
        let before = 0;
        let posted = new Decimal(0);
        for (const after of balances) {
          const amount = new Decimal(after - before).dividedBy(100).toString();
          const collectedBefore = new Decimal(before).dividedBy(100).toString();
          posted = posted.plus(
            profitForCollection({ ...t, collectedBefore, amount }),
          );
          const collected = new Decimal(after).dividedBy(100).toString();
          expect(posted.toString()).toBe(
            oracle(t.accountAmount, t.profitAmount, collected),
          );
          const exact = new Exact(collected)
            .times(t.profitAmount)
            .dividedBy(t.accountAmount);
          expect(exact.minus(posted).abs().lessThanOrEqualTo("0.005")).toBe(
            true,
          );
          before = after;
        }
        expect(posted.toString()).toBe(new Decimal(t.profitAmount).toString());
        expect(
          unearnedProfit({ ...t, collected: t.accountAmount }).isZero(),
        ).toBe(true);
      }),
    );
  });

  it("no posted amount has more than 2 decimal places", () => {
    fc.assert(
      fc.property(
        terms.chain((t) =>
          fc.tuple(
            fc.constant(t),
            fc.integer({ min: 0, max: t.accountPaise }),
            fc.integer({ min: 0, max: t.accountPaise }),
          ),
        ),
        ([t, a, b]) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          const profit = profitForCollection({
            ...t,
            collectedBefore: new Decimal(low).dividedBy(100).toString(),
            amount: new Decimal(high - low).dividedBy(100).toString(),
          });
          expect(profit.decimalPlaces()).toBeLessThanOrEqual(2);
          expect(profit.isNegative()).toBe(false);
        },
      ),
    );
  });
});
