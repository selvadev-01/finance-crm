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
