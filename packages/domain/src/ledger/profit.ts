import { Decimal } from "decimal.js";

import { type MoneyInput, toMoney, toPaise } from "../money/money.js";

/**
 * Proportional profit recognition (M09, BR-18).
 *
 * Profit is earned as money arrives, at `P / A` of every rupee collected.
 *
 * **Rounding is applied to the running total, never to a single collection.**
 * The profit earned to date is `round(collected × P / A)`, half-up to the
 * paisa, and a collection posts the change in that figure:
 *
 *     profit = round(collectedAfter × P/A) − round(collectedBefore × P/A)
 *
 * Consequences, each deliberate:
 *
 * - The ledger is never more than half a paisa from the exact figure, at any
 *   moment — rounding cannot accumulate.
 * - When `collected = A`, earned is exactly `P`, so `UNEARNED_PROFIT` for a
 *   completed account lands at zero with no need to identify "the final
 *   collection". That matters because offline syncs arrive late and
 *   corrections arrive after completion (BR-16a, BR-14).
 * - An adjustment uses the same formula with a negative amount. A full
 *   reversal can therefore differ from the original's profit by ₹0.01 when the
 *   ratio does not divide evenly; the ledger still balances.
 *
 * Uneven example — `A = 9,999`, `P = 1,499`, ₹100 a day: most days post
 * ₹14.99, about one day in seven posts ₹15.00, and the 100th collection (₹99)
 * posts ₹14.84, bringing earned profit to exactly ₹1,499.
 *
 * All arithmetic is integer paise in BigInt: the ratio is never materialised
 * as a decimal, so no precision setting can change a posted amount.
 */
export interface AccountProfitTerms {
  /** `A`. */
  accountAmount: MoneyInput;
  /** `P = A − I` (BR-01). */
  profitAmount: MoneyInput;
}

/** Profit earned once `collected` has been received: `round(collected × P / A)`. */
export function recognisedProfit(
  input: AccountProfitTerms & { collected: MoneyInput },
): Decimal {
  const terms = toTerms(input);
  return fromPaise(
    recognisedPaise(terms, collectedPaise(terms, input.collected)),
  );
}

/**
 * The profit to post with one collection or adjustment of `amount`, given the
 * account had `collectedBefore` confirmed. Positive for a collection, negative
 * for a downward adjustment, zero for `NO_PAYMENT`.
 *
 * > `A = 10,000`, `P = 1,500`: a collection of ₹100 posts ₹15.00 —
 * > debit `UNEARNED_PROFIT`, credit `EARNED_PROFIT`. A negative result posts
 * > the same two lines the other way round.
 */
export function profitForCollection(
  input: AccountProfitTerms & {
    collectedBefore: MoneyInput;
    amount: MoneyInput;
  },
): Decimal {
  const terms = toTerms(input);
  const before = collectedPaise(
    terms,
    input.collectedBefore,
    "collectedBefore",
  );
  const after = before + toPaise(toMoney(input.amount, "amount"));
  if (after < 0n || after > terms.account) {
    throw new RangeError(
      `collected after this entry would be ${fromPaise(after).toString()}, outside 0…${fromPaise(terms.account).toString()} — ` +
        "collections cannot exceed the account amount (US-041) or go below zero",
    );
  }
  return fromPaise(
    recognisedPaise(terms, after) - recognisedPaise(terms, before),
  );
}

/**
 * `P − recognisedProfit(collected)`: what `UNEARNED_PROFIT` holds for the
 * account. Zero once fully collected; on write-off, the amount to clear.
 */
export function unearnedProfit(
  input: AccountProfitTerms & { collected: MoneyInput },
): Decimal {
  const terms = toTerms(input);
  const earned = recognisedPaise(terms, collectedPaise(terms, input.collected));
  return fromPaise(terms.profit - earned);
}

interface Terms {
  account: bigint;
  profit: bigint;
}

function toTerms(input: AccountProfitTerms): Terms {
  const account = toPaise(toMoney(input.accountAmount, "accountAmount"));
  const profit = toPaise(toMoney(input.profitAmount, "profitAmount"));
  // BR-01: A > 0, I > 0 and I < A, so 0 < P < A.
  if (account <= 0n) {
    throw new RangeError("accountAmount must be > 0 (BR-01)");
  }
  if (profit <= 0n || profit >= account) {
    throw new RangeError(
      "profitAmount must be > 0 and below accountAmount (BR-01: 0 < I < A)",
    );
  }
  return { account, profit };
}

function collectedPaise(
  terms: Terms,
  value: MoneyInput,
  name = "collected",
): bigint {
  const paise = toPaise(toMoney(value, name));
  if (paise < 0n || paise > terms.account) {
    throw new RangeError(
      `${name} must be within 0…accountAmount, got ${fromPaise(paise).toString()}`,
    );
  }
  return paise;
}

/**
 * `collected × P / A` rounded half-up to the paisa (BR-11). Both operands are
 * non-negative, so half-up is `floor((2 × c × P + A) / (2 × A))`.
 */
function recognisedPaise(terms: Terms, collected: bigint): bigint {
  return (2n * collected * terms.profit + terms.account) / (2n * terms.account);
}

function fromPaise(paise: bigint): Decimal {
  return new Decimal(paise.toString()).dividedBy(100);
}
