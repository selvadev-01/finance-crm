import type { Decimal } from "decimal.js";

import { type MoneyInput, toMoney } from "../money/money.js";

/**
 * Variance classification (M07, BR-08).
 *
 * Mirrors the `Classification` enum. `MISSED` is deliberately absent: a missed
 * visit has no collection row to classify — it is a schedule status set by the
 * scheduled job after day close (BR-09).
 */
export type Classification = "CORRECT" | "LOW" | "EXTRA" | "NO_PAYMENT";

export interface ClassifiedCollection {
  /** `amount − expectedAmount`. Stored, never recomputed (BR-08). */
  variance: Decimal;
  classification: Classification;
}

/**
 * Classifies an `ORIGINAL` collection at write time. Adjustments are not
 * classified (BR-14) and must not be passed here.
 *
 * | Condition                       | Classification |
 * | ------------------------------- | -------------- |
 * | `amount = 0`                    | `NO_PAYMENT`   |
 * | `amount > 0`, `variance = 0`    | `CORRECT`      |
 * | `amount > 0`, `variance < 0`    | `LOW`          |
 * | `amount > 0`, `variance > 0`    | `EXTRA`        |
 *
 * `amount = 0` is tested first. A visit where nothing was paid is a customer
 * signal even when nothing was expected, and `collection_classification_check`
 * accepts only `NO_PAYMENT` for a zero amount.
 *
 * **Exact match, no tolerance band.** ₹99.99 against ₹100 is `LOW`. If a
 * `collection.varianceTolerance` setting is ever added, the database
 * constraint must be relaxed in the same change.
 */
export function classifyCollection(input: {
  amount: MoneyInput;
  expectedAmount: MoneyInput;
}): ClassifiedCollection {
  const amount = toMoney(input.amount, "amount");
  const expectedAmount = toMoney(input.expectedAmount, "expectedAmount");
  if (amount.isNegative()) {
    throw new RangeError(
      `amount must be ≥ 0 on an original collection; a negative amount is an ADJUSTMENT (BR-14), got ${amount.toString()}`,
    );
  }
  if (expectedAmount.isNegative()) {
    throw new RangeError(
      `expectedAmount must be ≥ 0 (BR-07), got ${expectedAmount.toString()}`,
    );
  }

  const variance = amount.minus(expectedAmount);
  return { variance, classification: classify(amount, variance) };
}

function classify(amount: Decimal, variance: Decimal): Classification {
  if (amount.isZero()) return "NO_PAYMENT";
  if (variance.isZero()) return "CORRECT";
  return variance.isNegative() ? "LOW" : "EXTRA";
}
