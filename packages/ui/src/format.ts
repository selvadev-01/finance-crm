/**
 * Display formatting.
 *
 * Everything here takes a **decimal string** and returns a string. No value in
 * this file is ever converted to `number`, because a JavaScript number is an
 * IEEE-754 double and ₹0.10 + ₹0.20 is famously not ₹0.30 in one. Amounts
 * cross the API as decimal strings precisely so they never have to be.
 *
 * `toFixed` is banned for the same reason, and it also rounds half-to-even on
 * some values, which is not what the business rules specify.
 */

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d*))?$/;

/**
 * Group digits the Indian way: the last three, then pairs.
 * 123456 becomes 1,23,456 — not 123,456.
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;

  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const groups: string[] = [];

  let index = rest.length;
  while (index > 2) {
    groups.unshift(rest.slice(index - 2, index));
    index -= 2;
  }
  if (index > 0) groups.unshift(rest.slice(0, index));

  return `${groups.join(",")},${lastThree}`;
}

/**
 * A whole count for display: `formatCount(1234)` → `1,234`, grouped the Indian
 * way like every other number on screen. For counts of rows only — never for
 * money, which stays a decimal string from the API to the screen (BR-11).
 */
export function formatCount(count: number): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `formatCount expects a whole count, received ${JSON.stringify(count)}.`,
    );
  }
  return groupIndian(String(count));
}

/**
 * Render a money amount for display: `formatCurrency("123456.5")` → `₹1,23,456.50`.
 *
 * Accepts at most two decimal places. More than that is rejected rather than
 * quietly truncated or rounded: every money column is `NUMERIC(14,2)`, so a
 * third decimal means something upstream produced a value the database cannot
 * store, and hiding it here would turn a visible bug into a silent one.
 * Rounding belongs in `@repo/domain`, at an explicit boundary (BR-11).
 */
export function formatCurrency(amount: string): string {
  const match = DECIMAL_PATTERN.exec(amount.trim());

  if (!match) {
    throw new Error(
      `formatCurrency expects a decimal string, received ${JSON.stringify(amount)}.`,
    );
  }

  const [, sign = "", whole = "0", fraction = ""] = match;

  if (fraction.length > 2) {
    throw new Error(
      `formatCurrency received ${amount}, which has more than two decimal ` +
        `places. Round in @repo/domain before display — money columns are ` +
        `NUMERIC(14,2) and cannot store this value.`,
    );
  }

  const paise = fraction.padEnd(2, "0");
  return `${sign}₹${groupIndian(whole)}.${paise}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Render a business date: `formatBusinessDate("2026-09-13")` → `13 Sep 2026`.
 *
 * Takes the plain `YYYY-MM-DD` string the API sends, and deliberately does not
 * accept a `Date`. Constructing a `Date` from a business date re-introduces a
 * timezone, and a business date has none — it is the calendar day the money
 * moved in Asia/Kolkata, decided once by `toBusinessDate` in @repo/domain
 * (BR-12). A business date never shows a time.
 */
export function formatBusinessDate(
  businessDate: string,
  /** `day-month` — `13 Sep` — for a chart's axis, where the year is the reader's. */
  style: "full" | "day-month" = "full",
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate.trim());

  if (!match) {
    throw new Error(
      `formatBusinessDate expects YYYY-MM-DD, received ${JSON.stringify(businessDate)}.`,
    );
  }

  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];

  if (!monthName) {
    throw new Error(`formatBusinessDate received an invalid month: ${month}.`);
  }

  return style === "day-month"
    ? `${Number(day)} ${monthName}`
    : `${day} ${monthName} ${year}`;
}
