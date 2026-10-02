import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  formatPaiseForMessage,
  idSchema,
  moneyStringSchema,
  pageQuerySchema,
  pageSchema,
  positiveMoneySchema,
  toPaise,
} from "./shared.js";

/**
 * Books slice 5 (ADR-0018) — the manual journal: the Super Admin's correcting
 * entry for what no business event records (a category booked wrongly, an
 * opening balance, bank charges found on the passbook). Balanced lines over
 * the business's own accounts only.
 *
 * **Never** cash in hand, a loan receivable, or unearned or earned profit:
 * the nightly reconciliation checks those against the loan book and the
 * collections (US-095), so a hand-made entry there would be flagged forever —
 * and the way to change them is the business event (a correction, a
 * handover, a write-off) that keeps the loan book in step.
 */

/** The accounts a journal may touch. */
export const journalAccountTypeSchema = z.enum([
  "CASH_AT_OFFICE",
  "BANK",
  "EXPENSE",
  "OTHER_INCOME",
  "CAPITAL",
  "OWNER_DRAWINGS",
  "WRITE_OFF_LOSS",
]);

export const journalLineInputSchema = z
  .object({
    accountType: journalAccountTypeSchema,
    /** Which bank, for `BANK`. */
    bankAccountId: idSchema.optional(),
    /** Which category, for `EXPENSE`. */
    categoryId: idSchema.optional(),
    direction: z.enum(["DEBIT", "CREDIT"]),
    amount: positiveMoneySchema,
  })
  .superRefine((line, context) => {
    if (line.accountType === "BANK" && !line.bankAccountId) {
      context.addIssue({
        code: "custom",
        path: ["bankAccountId"],
        message: "choose the bank",
      });
    }
    if (line.accountType === "EXPENSE" && !line.categoryId) {
      context.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "choose the category",
      });
    }
  });

export const postJournalBodySchema = z
  .object({
    /** Today when absent; never in the future. */
    businessDate: calendarDateSchema.optional(),
    note: z.string().trim().min(1, "say why this entry is needed").max(500),
    lines: z
      .array(journalLineInputSchema)
      .min(2, "a journal needs two lines or more")
      .max(20),
  })
  .superRefine((body, context) => {
    const total = (direction: "DEBIT" | "CREDIT") =>
      body.lines
        .filter((line) => line.direction === direction)
        .reduce((sum, line) => sum + toPaise(line.amount), 0n);
    const debits = total("DEBIT");
    const credits = total("CREDIT");
    if (debits === 0n || credits === 0n) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "a journal needs at least one debit and one credit",
      });
    } else if (debits !== credits) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: `debits ₹${formatPaiseForMessage(debits)} and credits ₹${formatPaiseForMessage(credits)} must be equal`,
      });
    }
  });

export const journalEntrySchema = z.object({
  id: idSchema,
  businessDate: calendarDateSchema,
  note: z.string(),
  lines: z.array(
    z.object({
      accountType: journalAccountTypeSchema,
      /** "Office cash", "SBI Mylapore", "Rent", "Capital". */
      name: z.string(),
      direction: z.enum(["DEBIT", "CREDIT"]),
      amount: moneyStringSchema,
    }),
  ),
  /** Σ debits, equal to Σ credits. */
  amount: moneyStringSchema,
  recordedBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const journalContract = {
  listJournalEntries: route({
    method: "GET",
    path: "/api/journal-entries",
    summary:
      "Manual journal entries with their lines, newest first (ADR-0018, Admin+)",
    query: pageQuerySchema.extend({
      from: calendarDateSchema.optional(),
      to: calendarDateSchema.optional(),
    }),
    responses: { 200: pageSchema(journalEntrySchema), ...errors },
  }),

  postJournalEntry: route({
    method: "POST",
    path: "/api/journal-entries",
    summary:
      "Post a balanced manual journal over the business's own accounts (Super Admin, ADR-0018)",
    body: postJournalBodySchema,
    responses: { 201: journalEntrySchema, ...errors, 422: errorSchema },
  }),
} as const;

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;
