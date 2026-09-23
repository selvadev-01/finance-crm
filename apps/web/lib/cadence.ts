import { COLLECTION_FREQUENCIES, type CollectionFrequency } from "@repo/domain";

/**
 * BR-04: how the console words each collection cadence.
 *
 * The cadence renames the two fields that are counted in it — the instalment
 * amount and the term — so a weekly account is never labelled in days. `D` is
 * one instalment and `N` the number of them at every cadence: only the unit
 * changes, which is why the labels move and the money rules do not.
 *
 * Shared by the new-account form (S-04) and the pending-terms correction
 * dialog (S-11), so the same account cannot be described two ways.
 */
export const CADENCE: Record<
  CollectionFrequency,
  {
    /** In the frequency picker. */
    option: string;
    /** The instalment amount's label on a form, and on a read-only stat. */
    amount: string;
    amountShort: string;
    /** The term's label on a form, and the unit `termDays` is counted in. */
    term: string;
    termUnit: string;
    /** What the disbursement date means at this cadence (BR-03). */
    firstSlot: string;
  }
> = {
  DAILY: {
    option: "Daily — every working day",
    amount: "Daily amount (₹)",
    amountShort: "Daily amount",
    term: "Term (days)",
    termUnit: "days",
    firstSlot: "Day 0 — collection starts the next working day.",
  },
  WEEKLY: {
    option: "Weekly — once a week",
    amount: "Weekly amount (₹)",
    amountShort: "Weekly amount",
    term: "Term (weeks)",
    termUnit: "weeks",
    firstSlot: "Day 0 — collection starts a week later, on the same weekday.",
  },
  MONTHLY: {
    option: "Monthly — once a month",
    amount: "Monthly amount (₹)",
    amountShort: "Monthly amount",
    term: "Term (months)",
    termUnit: "months",
    firstSlot:
      "Day 0 — collection starts a month later, on the same day of the month.",
  },
};

/**
 * A watched form value narrowed to a cadence. A half-typed or absent value
 * reads as `DAILY`, which is what the field defaults to — the labels follow
 * the picker rather than blanking while the form settles.
 */
export function cadenceOf(value: unknown): CollectionFrequency {
  return typeof value === "string" &&
    (COLLECTION_FREQUENCIES as readonly string[]).includes(value)
    ? (value as CollectionFrequency)
    : "DAILY";
}
