import { Decimal } from "decimal.js";

/**
 * Money is `NUMERIC(14,2)` (BR-11, ADR-0009). Every amount entering the domain
 * passes through `toMoney`, which refuses anything the database could not
 * store — rather than rounding it into something plausible.
 *
 * Accepts a decimal string or a `Decimal`. Never a JS `number`: the type does
 * not allow it, because `0.1 + 0.2` has already drifted before it arrives.
 */
export type MoneyInput = string | Decimal;

/** The largest magnitude `NUMERIC(14,2)` holds. */
export const MAX_MONEY = new Decimal("999999999999.99");

export function toMoney(value: MoneyInput, name = "amount"): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new RangeError(`${name} is not a decimal: ${String(value)}`);
  }
  if (!amount.isFinite()) {
    throw new RangeError(`${name} must be finite, got ${amount.toString()}`);
  }
  if (amount.decimalPlaces() > 2) {
    throw new RangeError(
      `${name} has more than 2 decimal places (BR-11): ${amount.toString()}`,
    );
  }
  if (amount.abs().greaterThan(MAX_MONEY)) {
    throw new RangeError(
      `${name} exceeds NUMERIC(14,2) (BR-11): ${amount.toString()}`,
    );
  }
  return amount;
}

/**
 * Exact paise as a BigInt, for integer arithmetic with no precision setting to
 * reason about. Only for values that came through `toMoney`: at most 2 decimal
 * places and 14 digits, so `× 100` is an integer below 10^14 and `toString`
 * never switches to exponent notation.
 */
export function toPaise(amount: Decimal): bigint {
  return BigInt(amount.times(100).toString());
}
