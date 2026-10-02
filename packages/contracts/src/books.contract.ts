import { z } from "zod";

import { route } from "./route.js";
import { errorSchema, idSchema, nameSchema } from "./shared.js";

/**
 * Books (ADR-0018) — the business's own money beside the loan book: expense
 * categories and bank accounts (slice 1), then expenses, bank transfers,
 * other income, owner drawings, manual journals and the statements.
 */

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

// ------------------------------------------------------ Expense categories

export const expenseCategorySchema = z.object({
  id: idSchema,
  name: z.string(),
  /** A retired category takes no new expenses; its history stays. */
  isActive: z.boolean(),
});

const categoryParams = z.object({ categoryId: idSchema });

// ------------------------------------------------------------ Bank accounts

export const bankAccountSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** The account number's last four digits, to tell two apart. */
  last4: z.string().nullable(),
  isActive: z.boolean(),
  /** The BANK ledger account's balance now; `0.00` before any movement. */
  balance: z.string(),
});

const last4Schema = z
  .string()
  .trim()
  .regex(/^[0-9]{4}$/, "must be the last four digits of the account number")
  .optional()
  .transform((value) => (value ? value : undefined));

const bankParams = z.object({ bankAccountId: idSchema });

export const booksContract = {
  listExpenseCategories: route({
    method: "GET",
    path: "/api/expense-categories",
    summary:
      "The organization's expense categories, active first; retired ones only when asked (ADR-0018)",
    query: z.object({
      includeRetired: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    }),
    responses: {
      200: z.object({ data: z.array(expenseCategorySchema) }),
      ...errors,
    },
  }),

  createExpenseCategory: route({
    method: "POST",
    path: "/api/expense-categories",
    summary: "Add an expense category (Super Admin, ADR-0018)",
    body: z.object({ name: nameSchema }),
    responses: {
      201: expenseCategorySchema,
      ...errors,
      409: errorSchema,
    },
  }),

  updateExpenseCategory: route({
    method: "PATCH",
    path: "/api/expense-categories/:categoryId",
    summary:
      "Rename, retire or bring back an expense category — never delete it (Super Admin, ADR-0018)",
    pathParams: categoryParams,
    body: z.object({ name: nameSchema, isActive: z.boolean() }),
    responses: {
      200: expenseCategorySchema,
      ...errors,
      409: errorSchema,
    },
  }),

  listBankAccounts: route({
    method: "GET",
    path: "/api/bank-accounts",
    summary:
      "The business's bank accounts with their balances, retired ones only when asked (ADR-0018)",
    query: z.object({
      includeRetired: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    }),
    responses: {
      200: z.object({ data: z.array(bankAccountSchema) }),
      ...errors,
    },
  }),

  createBankAccount: route({
    method: "POST",
    path: "/api/bank-accounts",
    summary: "Add a bank account the business keeps (Super Admin, ADR-0018)",
    body: z.object({ name: nameSchema, last4: last4Schema }),
    responses: {
      201: bankAccountSchema,
      ...errors,
      409: errorSchema,
    },
  }),

  updateBankAccount: route({
    method: "PATCH",
    path: "/api/bank-accounts/:bankAccountId",
    summary:
      "Rename, retire or bring back a bank account — never delete it (Super Admin, ADR-0018)",
    pathParams: bankParams,
    body: z.object({
      name: nameSchema,
      last4: last4Schema,
      isActive: z.boolean(),
    }),
    responses: {
      200: bankAccountSchema,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),
} as const;

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export type BankAccountView = z.infer<typeof bankAccountSchema>;
