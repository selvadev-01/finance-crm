/**
 * Rupee amounts as the API sends them — decimal strings with at most two
 * places, possibly signed — and the few sums a screen needs, done in exact
 * paise on BigInt. A money value never passes through a JS number (BR-11,
 * coding-guidelines.md non-negotiable 1). Display goes through
 * `formatCurrency`, which takes the string.
 *
 * Framework-free: the offline engine and the service worker import it too.
 */

/** `"-12.5"` → `-1250n`. Signed, unlike `@repo/contracts`' `toPaise`. */
export function toPaise(value: string): bigint {
  const negative = value.startsWith("-");
  const [rupees = "0", fraction = ""] = value.replace("-", "").split(".");
  const paise =
    BigInt(rupees || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -paise : paise;
}

/** `-1250n` → `"-12.50"`: always two places, a minus only when below zero. */
export function fromPaise(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export function addMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) + toPaise(b));
}

/** Exact decimal subtraction in paise — never a floating-point number (BR-11). */
export function subtractMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}

export function sumMoney(values: readonly string[]): string {
  return fromPaise(values.reduce((total, value) => total + toPaise(value), 0n));
}

export function isZeroMoney(value: string): boolean {
  return toPaise(value) === 0n;
}

export function isNegativeMoney(value: string): boolean {
  return toPaise(value) < 0n;
}

/** The amount without its sign, for "₹20.00 short" after the sign is read. */
export function absMoney(value: string): string {
  const paise = toPaise(value);
  return fromPaise(paise < 0n ? -paise : paise);
}

/**
 * `part` as tenths of a percent of `whole`, rounded down, from exact paise:
 * ₹1,62,750 of ₹1,84,300 is 883 (88.3%). Null when `whole` is not above
 * zero — there is no share of nothing. The result is a ratio for a progress
 * bar, never an amount; below zero reads as 0.
 */
export function perMille(part: string, whole: string): number | null {
  const total = toPaise(whole);
  if (total <= 0n) return null;
  const share = (toPaise(part) * 1000n) / total;
  return share < 0n ? 0 : Number(share);
}

/** `883` → `"88.3%"`. */
export function formatPerMille(value: number): string {
  return `${Math.floor(value / 10)}.${value % 10}%`;
}

/** `a` compared with `b`: negative, zero or positive. */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const difference = toPaise(a) - toPaise(b);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
