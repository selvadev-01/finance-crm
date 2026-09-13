import { z } from "zod";

/**
 * Schemas shared by every contract.
 */

/**
 * A calendar date, `YYYY-MM-DD`, that actually exists. Business dates and
 * effective dates travel in this form — never as an instant (BR-12).
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "must be a date in YYYY-MM-DD form",
    abort: true,
  })
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "is not a real calendar date");

/** A row id as issued by the database. Opaque to clients. */
export const idSchema = z.string().min(1).max(64);

/** Human-readable business codes: `SEC-01`, `LN-07`. */
export const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]*$/,
    "may contain letters, digits and hyphens",
  );

export const nameSchema = z.string().trim().min(1).max(120);

/**
 * Money crosses the API as a decimal string (BR-11, ADR-0009): up to twelve
 * digits and two decimal places, the shape of `NUMERIC(14,2)`. Never a JSON
 * number. Commas and spaces a person typed are removed; anything else that is
 * not a plain decimal is refused rather than rounded.
 */
export const moneyStringSchema = z
  .string()
  .transform((value) => value.replace(/[\s,]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^\d{1,12}(\.\d{1,2})?$/,
        "must be an amount in rupees, with at most two decimal places",
      ),
  );

/** A money string that may be negative — variances and adjustments. */
export const signedMoneyStringSchema = z
  .string()
  .regex(
    /^-?\d{1,12}(\.\d{1,2})?$/,
    "must be an amount in rupees, with at most two decimal places",
  );

/** A money string that is strictly positive. */
export const positiveMoneySchema = moneyStringSchema.pipe(
  // A pipe, not a refine: it runs only once the shape is valid, so a malformed
  // amount gets one message and toPaise never sees it.
  z.string().refine((value) => toPaise(value) > 0n, "must be more than zero"),
);

/**
 * Exact paise as a BigInt, for comparisons inside schemas — this package may
 * not depend on a decimal library, and a JS number would already be inexact.
 * Only for strings `moneyStringSchema` accepted.
 */
export function toPaise(value: string): bigint {
  const [rupees = "0", paise = ""] = value.split(".");
  return BigInt(rupees) * 100n + BigInt(paise.padEnd(2, "0"));
}

/** `1234567.5` → `12,34,567.50` — for messages only; the UI uses formatCurrency. */
export function formatPaiseForMessage(paise: bigint): string {
  const rupees = (paise / 100n).toString();
  const fraction = (paise % 100n).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return fraction === "00" ? grouped : `${grouped}.${fraction}`;
}

/** Cursor pagination on every list endpoint (api-design.md#pagination). */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}

/** The error body every non-2xx response carries (api-design.md#errors). */
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z
    .array(z.object({ field: z.string(), issue: z.string() }))
    .optional(),
  correlationId: z.string(),
});

export type ApiError = z.infer<typeof errorSchema>;
