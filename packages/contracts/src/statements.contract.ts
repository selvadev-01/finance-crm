import { z } from "zod";

import {
  ledgerAccountTypeSchema,
  ledgerTransactionTypeSchema,
} from "./ledger.contract.js";
import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  signedMoneyStringSchema,
} from "./shared.js";

/**
 * Books slice 4 (ADR-0018) — the statements an accountant reads, all from the
 * ledger's **entries** (never the cached balances), so each agrees with the
 * trial balance to the paisa:
 *
 * - **Profit and loss** over a range: what was earned (profit recognised on
 *   collections, other income) less what was spent (expenses by category,
 *   write-off losses).
 * - **Balance sheet** at a date: where the money is and who it belongs to.
 *   Its two sides are equal whenever the ledger balances.
 * - **Account statement**: one ledger account's entries with a running
 *   balance; the **cash book** is the statement of office cash or a bank.
 *
 * Admins and above (`ledger.view`), like the rest of the ledger.
 */

/** Statements may span a year; longer is narrowed by the caller. */
export const MAX_STATEMENT_DAYS = 366;

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  422: errorSchema,
};

/** `to` defaults to today and `from` to the first of `to`'s month. */
export const statementRangeQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

// ----------------------------------------------------------- Profit and loss

export const profitAndLossSchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema,
  generatedAt: z.string(),
  income: z.object({
    /** Profit recognised on the collections in the range (BR-18). */
    earnedProfit: signedMoneyStringSchema,
    /** Income that is not a collection. */
    otherIncome: signedMoneyStringSchema,
    total: signedMoneyStringSchema,
  }),
  expenses: z.object({
    /** One row per category with anything in the range, largest first. */
    categories: z.array(
      z.object({
        categoryId: idSchema,
        name: z.string(),
        amount: signedMoneyStringSchema,
      }),
    ),
    /** Principal written off on defaulted accounts (US-035). */
    writeOffLoss: signedMoneyStringSchema,
    total: signedMoneyStringSchema,
  }),
  /** Income less expenses: negative is a loss. */
  netProfit: signedMoneyStringSchema,
});

// ------------------------------------------------------------- Balance sheet

const holding = z.object({
  id: z.string(),
  name: z.string(),
  balance: signedMoneyStringSchema,
});

export const balanceSheetSchema = z.object({
  asOf: calendarDateSchema,
  generatedAt: z.string(),
  assets: z.object({
    officeCash: signedMoneyStringSchema,
    banks: z.array(holding),
    /** Cash collected and not yet at the office, per staff member. */
    cashWithStaff: z.array(holding),
    /** Σ what customers owe on their accounts. */
    loansReceivable: signedMoneyStringSchema,
    /** Profit inside the receivables not yet earned — deducted from them. */
    unearnedProfit: signedMoneyStringSchema,
    total: signedMoneyStringSchema,
  }),
  equity: z.object({
    capital: signedMoneyStringSchema,
    /** Taken out by the owner — deducted. */
    drawings: signedMoneyStringSchema,
    /** Every profit and loss since the books began, to `asOf`. */
    retainedProfit: signedMoneyStringSchema,
    total: signedMoneyStringSchema,
  }),
  /** The two totals are equal. False is a defect to report. */
  balanced: z.boolean(),
});

// -------------------------------------------------------- Account statement

export const statementEntrySchema = z.object({
  ledgerTransactionId: idSchema,
  businessDate: calendarDateSchema,
  transactionType: ledgerTransactionTypeSchema,
  description: z.string(),
  debit: moneyStringSchema,
  credit: moneyStringSchema,
  /** After this entry, on the account's normal side: negative is the other side. */
  balance: signedMoneyStringSchema,
});

export const accountStatementSchema = z.object({
  account: z.object({
    /**
     * Null only for a cash book of a place nothing has ever moved through:
     * reading never creates a ledger account.
     */
    ledgerAccountId: idSchema.nullable(),
    accountType: ledgerAccountTypeSchema,
    /** "Office cash", "SBI Mylapore", "Ravi's cash in hand", "Rent". */
    name: z.string(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]),
  }),
  from: calendarDateSchema,
  to: calendarDateSchema,
  generatedAt: z.string(),
  /** Before `from`. */
  opening: signedMoneyStringSchema,
  /** Oldest first. */
  entries: z.array(statementEntrySchema),
  totals: z.object({ debits: moneyStringSchema, credits: moneyStringSchema }),
  closing: signedMoneyStringSchema,
});

export const statementsContract = {
  getProfitAndLoss: route({
    method: "GET",
    path: "/api/books/profit-and-loss",
    summary:
      "Profit and loss over a range, from the ledger's entries (ADR-0018, Admin+)",
    query: statementRangeQuerySchema,
    responses: { 200: profitAndLossSchema, ...errors },
  }),

  getBalanceSheet: route({
    method: "GET",
    path: "/api/books/balance-sheet",
    summary:
      "Assets against capital and retained profit at a business date (ADR-0018, Admin+)",
    query: z.object({ date: calendarDateSchema.optional() }),
    responses: { 200: balanceSheetSchema, ...errors },
  }),

  getAccountStatement: route({
    method: "GET",
    path: "/api/ledger/accounts/:ledgerAccountId/statement",
    summary:
      "One ledger account's entries over a range with a running balance (ADR-0018, Admin+)",
    pathParams: z.object({ ledgerAccountId: idSchema }),
    query: statementRangeQuerySchema,
    responses: { 200: accountStatementSchema, ...errors },
  }),

  getCashBook: route({
    method: "GET",
    path: "/api/books/cash-book",
    summary:
      "The statement of office cash, or of one bank, over a range (ADR-0018, Admin+)",
    query: statementRangeQuerySchema.extend({
      /** Absent: office cash. */
      bankAccountId: idSchema.optional(),
    }),
    responses: { 200: accountStatementSchema, ...errors },
  }),
} as const;

export type ProfitAndLoss = z.infer<typeof profitAndLossSchema>;
export type BalanceSheet = z.infer<typeof balanceSheetSchema>;
export type AccountStatement = z.infer<typeof accountStatementSchema>;
export type StatementEntry = z.infer<typeof statementEntrySchema>;
