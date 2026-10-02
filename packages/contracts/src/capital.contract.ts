import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  pageQuerySchema,
  pageSchema,
  positiveMoneySchema,
  signedMoneyStringSchema,
} from "./shared.js";

/**
 * M08 · money the owner puts into the business (US-032, decided 2026-09-24).
 *
 * Each entry posts debit `CASH_AT_OFFICE`, credit `CAPITAL`, so office cash is
 * funded rather than running negative as accounts are disbursed. Recording one
 * is the Super Admin's alone (`capital.add`); reading them is the ledger's
 * permission (`ledger.view`, Admin and above), since they are ledger money.
 * Entries are never edited — a mistake is answered by a later entry.
 */

export const capitalEntrySchema = z.object({
  id: idSchema,
  amount: moneyStringSchema,
  businessDate: calendarDateSchema,
  note: z.string(),
  /** Who recorded it; null only if that user no longer exists. */
  addedBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
});

export const capitalPageSchema = pageSchema(capitalEntrySchema).extend({
  /** Every entry ever recorded, not only this page's. */
  totalCapital: moneyStringSchema,
  /** `CASH_AT_OFFICE` now — negative while disbursements outrun capital. */
  officeCash: signedMoneyStringSchema,
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
};

export const capitalContract = {
  listCapital: route({
    method: "GET",
    path: "/api/capital",
    summary:
      "Capital put into the business, newest first, with the total and office cash now (US-032)",
    query: pageQuerySchema,
    responses: { 200: capitalPageSchema, ...errors },
  }),

  addCapital: route({
    method: "POST",
    path: "/api/capital",
    summary:
      "Record money put into the business, funding office cash (US-032, Super Admin)",
    body: z.object({
      amount: positiveMoneySchema,
      /** The day the money arrived. Today when absent; never in the future. */
      businessDate: calendarDateSchema.optional(),
      /** Where the money came from — the ledger records only the amount. */
      note: z.string().trim().min(1).max(500),
    }),
    responses: { 201: capitalEntrySchema, ...errors, 422: errorSchema },
  }),
} as const;

export type CapitalEntry = z.infer<typeof capitalEntrySchema>;
export type CapitalPage = z.infer<typeof capitalPageSchema>;
