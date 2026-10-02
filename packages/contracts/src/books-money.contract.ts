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
 * Books slice 2 (ADR-0018) — the business's own money moving: expenses, money
 * between office cash and the bank, income that is not a collection, and the
 * owner's drawings. Each entry is posted to the ledger in the same
 * transaction, and none is ever edited — a mistake is answered by a later
 * entry.
 */

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

const noteSchema = z.string().trim().min(1, "say what it was for").max(500);

/** The day the money moved. Today when absent; never in the future. */
const businessDateInput = calendarDateSchema.optional();

/**
 * Where money is held: office cash, or one of the business's banks. On the
 * wire a bank is its id and office cash is the absence of one.
 */
const bankChoice = z
  .string()
  .max(64)
  .optional()
  .transform((value) => (value ? value : undefined));

const person = z.object({ userId: z.string(), name: z.string() }).nullable();
const place = z.object({
  bankAccountId: idSchema.nullable(),
  name: z.string(),
});

// ---------------------------------------------------------------- Expenses

export const expensePaidFromSchema = z.enum([
  "OFFICE_CASH",
  "BANK",
  "CASH_IN_HAND",
]);
export const expenseStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const expenseSchema = z.object({
  id: idSchema,
  category: z.object({ id: idSchema, name: z.string() }),
  amount: moneyStringSchema,
  businessDate: calendarDateSchema,
  note: z.string(),
  paidFrom: expensePaidFromSchema,
  /** Office cash, a bank, or — for a field expense — the spender's cash. */
  from: place,
  /** A field expense: who spent it, and on which line's round. */
  spender: person,
  line: z.object({ id: idSchema, name: z.string() }).nullable(),
  status: expenseStatusSchema,
  decidedBy: person,
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  recordedBy: person,
  createdAt: z.string(),
  /**
   * Whether the caller may approve or reject it now: a pending field expense
   * that is not their own, on their line for a Senior deciding a Junior's,
   * any for an Admin. The API decides again on the request.
   */
  canDecide: z.boolean(),
});

export const expensePageSchema = pageSchema(expenseSchema).extend({
  /** Σ approved expenses the filter matches, across every page. */
  approvedTotal: moneyStringSchema,
});

// ------------------------------------- Transfers, other income and drawings

export const moneyMovementSchema = z.object({
  id: idSchema,
  amount: moneyStringSchema,
  businessDate: calendarDateSchema,
  note: z.string(),
  /** Where the money came from: a bank, office cash, or the owner / payer. */
  from: place.nullable(),
  /** Where it went: a bank, office cash, or out of the business. */
  to: place.nullable(),
  recordedBy: person,
  createdAt: z.string(),
});

export const moneyMovementPageSchema = pageSchema(moneyMovementSchema).extend({
  /** Σ every entry the filter matches, across every page. */
  amountTotal: moneyStringSchema,
});

const rangeQuery = pageQuerySchema.extend({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

// ---------------------------------------------------------------- Overview

export const booksOverviewSchema = z.object({
  asOf: calendarDateSchema,
  /** Signed: office cash runs below zero while disbursements outrun capital. */
  officeCash: signedMoneyStringSchema,
  banks: z.array(
    z.object({
      bankAccountId: idSchema,
      name: z.string(),
      last4: z.string().nullable(),
      balance: signedMoneyStringSchema,
    }),
  ),
  /** The month so far, from its first day to `asOf`. */
  month: z.object({
    from: calendarDateSchema,
    expenses: moneyStringSchema,
    otherIncome: moneyStringSchema,
    drawings: moneyStringSchema,
    capital: moneyStringSchema,
    /** Field expenses still waiting for a decision, now. */
    pendingFieldExpenses: z.number().int().nonnegative(),
  }),
});

export const booksMoneyContract = {
  getBooksOverview: route({
    method: "GET",
    path: "/api/books/overview",
    summary:
      "Office cash and each bank now, and the month's expenses, income, drawings and capital (ADR-0018)",
    query: z.object({ date: calendarDateSchema.optional() }),
    responses: { 200: booksOverviewSchema, ...errors },
  }),

  listExpenses: route({
    method: "GET",
    path: "/api/expenses",
    summary:
      "Expenses over a range, newest first — every one for an Admin, a Senior's line's field expenses, a Junior's own (ADR-0018)",
    query: rangeQuery.extend({
      categoryId: idSchema.optional(),
      status: expenseStatusSchema.optional(),
      paidFrom: expensePaidFromSchema.optional(),
    }),
    responses: { 200: expensePageSchema, ...errors },
  }),

  recordExpense: route({
    method: "POST",
    path: "/api/expenses",
    summary:
      "Record an expense paid from office cash or a bank; posts it at once (Admin+, ADR-0018)",
    body: z
      .object({
        categoryId: idSchema,
        amount: positiveMoneySchema,
        businessDate: businessDateInput,
        note: noteSchema,
        paidFrom: z.enum(["OFFICE_CASH", "BANK"]),
        bankAccountId: bankChoice,
      })
      .superRefine((body, context) => {
        if (body.paidFrom === "BANK" && !body.bankAccountId) {
          context.addIssue({
            code: "custom",
            path: ["bankAccountId"],
            message: "choose the bank it was paid from",
          });
        }
      }),
    responses: { 201: expenseSchema, ...errors, 422: errorSchema },
  }),

  requestFieldExpense: route({
    method: "POST",
    path: "/api/expenses/field",
    summary:
      "Ask for a field expense paid from the cash you collected on your line today; it waits for approval (Senior, Junior, ADR-0018)",
    body: z.object({
      categoryId: idSchema,
      amount: positiveMoneySchema,
      note: noteSchema,
    }),
    responses: { 201: expenseSchema, ...errors, 422: errorSchema },
  }),

  decideExpense: route({
    method: "POST",
    path: "/api/expenses/:expenseId/decision",
    summary:
      "Approve or reject a pending field expense — never your own; a Senior's goes to an Admin (ADR-0018)",
    pathParams: z.object({ expenseId: idSchema }),
    body: z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        note: z.string().trim().max(500).optional(),
      })
      .superRefine((body, context) => {
        if (body.decision === "REJECTED" && !body.note) {
          context.addIssue({
            code: "custom",
            path: ["note"],
            message: "say why it is rejected",
          });
        }
      }),
    responses: {
      200: expenseSchema,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  listBankTransfers: route({
    method: "GET",
    path: "/api/bank-transfers",
    summary: "Money moved between office cash and the banks, newest first",
    query: rangeQuery,
    responses: { 200: moneyMovementPageSchema, ...errors },
  }),

  recordBankTransfer: route({
    method: "POST",
    path: "/api/bank-transfers",
    summary:
      "Deposit office cash in a bank, withdraw it, or move it between banks (Admin+, ADR-0018)",
    body: z
      .object({
        /** Blank: office cash. */
        fromBankAccountId: bankChoice,
        toBankAccountId: bankChoice,
        amount: positiveMoneySchema,
        businessDate: businessDateInput,
        note: noteSchema,
      })
      .superRefine((body, context) => {
        if (body.fromBankAccountId === body.toBankAccountId) {
          context.addIssue({
            code: "custom",
            path: ["toBankAccountId"],
            message: "must be a different place from where it comes",
          });
        }
      }),
    responses: { 201: moneyMovementSchema, ...errors, 422: errorSchema },
  }),

  listOtherIncome: route({
    method: "GET",
    path: "/api/other-income",
    summary: "Income that is not a collection, newest first",
    query: rangeQuery,
    responses: { 200: moneyMovementPageSchema, ...errors },
  }),

  recordOtherIncome: route({
    method: "POST",
    path: "/api/other-income",
    summary:
      "Record income that is not a collection, into office cash or a bank (Admin+, ADR-0018)",
    body: z.object({
      amount: positiveMoneySchema,
      businessDate: businessDateInput,
      note: noteSchema,
      /** Blank: office cash. */
      bankAccountId: bankChoice,
    }),
    responses: { 201: moneyMovementSchema, ...errors, 422: errorSchema },
  }),

  listDrawings: route({
    method: "GET",
    path: "/api/drawings",
    summary: "Money the owner took out of the business, newest first",
    query: rangeQuery,
    responses: { 200: moneyMovementPageSchema, ...errors },
  }),

  recordDrawing: route({
    method: "POST",
    path: "/api/drawings",
    summary:
      "Record money the owner took out, from office cash or a bank (Super Admin, ADR-0018)",
    body: z.object({
      amount: positiveMoneySchema,
      businessDate: businessDateInput,
      note: noteSchema,
      /** Blank: office cash. */
      bankAccountId: bankChoice,
    }),
    responses: { 201: moneyMovementSchema, ...errors, 422: errorSchema },
  }),
} as const;

export type Expense = z.infer<typeof expenseSchema>;
export type ExpensePage = z.infer<typeof expensePageSchema>;
export type MoneyMovement = z.infer<typeof moneyMovementSchema>;
export type MoneyMovementPage = z.infer<typeof moneyMovementPageSchema>;
export type BooksOverview = z.infer<typeof booksOverviewSchema>;
