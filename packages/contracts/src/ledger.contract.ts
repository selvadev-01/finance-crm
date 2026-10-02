import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M09 · the trial balance (M09 operations, "trial balance report", Admin+).
 *
 * Read from the **entries**, not the cached `balance` columns, so it is the
 * ledger's own statement: every account's debits and credits up to a business
 * date, netted to one balance on its normal side. Σ debit balances equals
 * Σ credit balances whenever the ledger balances — which the deferred trigger
 * guarantees per transaction (ADR-0006) — so `balanced` false is a defect to
 * report, never a state to explain away.
 */

export const ledgerAccountTypeSchema = z.enum([
  "CASH_IN_HAND",
  "CASH_AT_OFFICE",
  "LOAN_RECEIVABLE",
  "CAPITAL",
  "UNEARNED_PROFIT",
  "EARNED_PROFIT",
  "WRITE_OFF_LOSS",
  // Books (ADR-0018).
  "EXPENSE",
  "BANK",
  "OTHER_INCOME",
  "OWNER_DRAWINGS",
]);

export const trialBalanceRowSchema = z.object({
  accountType: ledgerAccountTypeSchema,
  /** `CASH_IN_HAND` rows are one per staff member; the rest one per type. */
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  /**
   * `EXPENSE` and `BANK` rows are one per category or bank: its id and name.
   * Null for every other type.
   */
  referenceId: z.string().nullable(),
  referenceName: z.string().nullable(),
  /** Ledger accounts summed into the row — the receivables, one per loan. */
  accounts: z.number().int().min(1),
  /** The account, when the row is exactly one — so it can open its statement. */
  ledgerAccountId: z.string().nullable(),
  /** Σ debit and Σ credit entries up to the date. */
  debits: moneyStringSchema,
  credits: moneyStringSchema,
  /** The net, on whichever side it falls; the other is `0.00`. */
  debitBalance: moneyStringSchema,
  creditBalance: moneyStringSchema,
});

export const trialBalanceSchema = z.object({
  /** Entries on this business date and before. */
  asOf: calendarDateSchema,
  generatedAt: z.string(),
  rows: z.array(trialBalanceRowSchema),
  totals: z.object({
    debitBalance: moneyStringSchema,
    creditBalance: moneyStringSchema,
  }),
  balanced: z.boolean(),
});

export const ledgerTransactionTypeSchema = z.enum([
  "DISBURSEMENT",
  "COLLECTION",
  "HANDOVER",
  "ADJUSTMENT",
  "WRITE_OFF",
  "CAPITAL",
  // Books (ADR-0018).
  "EXPENSE",
  "BANK_TRANSFER",
  "DRAWINGS",
  "OTHER_INCOME",
  "JOURNAL",
]);

/** One line of a posting: which account, which side, how much. */
export const ledgerEntryViewSchema = z.object({
  accountType: ledgerAccountTypeSchema,
  /** Cash in hand: whose. */
  ownerName: z.string().nullable(),
  /** An expense's category, or a bank's name. */
  referenceName: z.string().nullable(),
  /** A receivable: which loan. */
  accountLoanId: idSchema.nullable(),
  accountCode: z.string().nullable(),
  direction: z.enum(["DEBIT", "CREDIT"]),
  amount: moneyStringSchema,
});

/** A posting and its entries, as the ledger holds it (M09). */
export const ledgerTransactionViewSchema = z.object({
  id: idSchema,
  transactionType: ledgerTransactionTypeSchema,
  businessDate: calendarDateSchema,
  /** When the event happened, not when it was written. */
  eventAt: z.string(),
  description: z.string(),
  /** What caused it — `account_loan`, `collection`, `cash_handover`, `capital_entry`. */
  sourceTable: z.string(),
  sourceId: z.string(),
  /** Who caused it; null for a system posting. */
  createdByName: z.string().nullable(),
  /** Debits first, then credits, in the posting's order. */
  entries: z.array(ledgerEntryViewSchema),
  /** Σ debits, equal to Σ credits (ADR-0006). */
  amount: moneyStringSchema,
});

export const ledgerContract = {
  getTrialBalance: route({
    method: "GET",
    path: "/api/ledger/trial-balance",
    summary:
      "Every ledger account's balance from its entries, up to a business date (M09, Admin+)",
    query: z.object({
      /** Today when absent. */
      date: calendarDateSchema.optional(),
    }),
    responses: {
      200: trialBalanceSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),

  listTransactions: route({
    method: "GET",
    path: "/api/ledger/transactions",
    summary:
      "Postings and their entries over a date range, newest first (M09, Admin+)",
    query: pageQuerySchema.extend({
      from: calendarDateSchema,
      to: calendarDateSchema,
      type: ledgerTransactionTypeSchema.optional(),
    }),
    responses: {
      200: pageSchema(ledgerTransactionViewSchema),
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),
} as const;

export type LedgerTransactionView = z.infer<typeof ledgerTransactionViewSchema>;
export type TrialBalance = z.infer<typeof trialBalanceSchema>;
export type TrialBalanceRow = z.infer<typeof trialBalanceRowSchema>;
