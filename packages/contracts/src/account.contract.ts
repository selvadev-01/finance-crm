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
 * M05 Accounts — creation and disbursement (US-030, US-031, US-032).
 *
 * "Account" is the loan (glossary). Amounts are decimal strings throughout.
 */

export const accountStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "COMPLETED",
  "DEFAULTED",
  "WRITTEN_OFF",
]);

/** The shape `moneyStringSchema` accepts, after commas and spaces are removed. */
const MONEY_SHAPE = /^\d{1,12}(\.\d{1,2})?$/;

const termsShape = {
  /** A */
  accountAmount: positiveMoneySchema,
  /** I */
  investedAmount: positiveMoneySchema,
  /** D */
  dailyAmount: positiveMoneySchema,
  /** N — default 100 (M05). */
  termDays: z.coerce.number().int().min(1).max(1000).default(100),
  /** Day 0 — not itself a collection day (BR-03). */
  disbursementDate: calendarDateSchema,
  /**
   * US-030a: what the customer has actually paid so far, from their paper
   * collection note — **required when the disbursement date is in the past,
   * refused otherwise** (the API knows today; this schema does not). Never
   * inferred as days × daily amount.
   */
  collectedToDate: moneyStringSchema.optional(),
};

type Terms = {
  accountAmount: string;
  investedAmount: string;
  dailyAmount: string;
  termDays: number;
  collectedToDate?: string | undefined;
};

/**
 * BR-01's cross-field rules, in the words US-030 asks for, so the form and the
 * API give the same answer. The database enforces them again as CHECKs.
 * Skipped while a field is itself invalid — its own message is the useful one.
 */
function checkTerms(terms: Terms, context: z.RefinementCtx) {
  const amounts = [
    terms.accountAmount,
    terms.investedAmount,
    terms.dailyAmount,
  ];
  if (!amounts.every((value) => MONEY_SHAPE.test(value))) return;
  if (!Number.isInteger(terms.termDays) || terms.termDays < 1) return;
  const A = toPaise(terms.accountAmount);
  const I = toPaise(terms.investedAmount);
  const D = toPaise(terms.dailyAmount);
  if (A <= 0n || I <= 0n || D <= 0n) return;
  if (
    terms.collectedToDate !== undefined &&
    MONEY_SHAPE.test(terms.collectedToDate) &&
    toPaise(terms.collectedToDate) >= A
  ) {
    context.addIssue({
      code: "custom",
      path: ["collectedToDate"],
      message:
        "must be below the account amount — an account already paid in full is not entered",
    });
  }
  if (I >= A) {
    context.addIssue({
      code: "custom",
      path: ["investedAmount"],
      message:
        "must be below the account amount — profit cannot be zero or negative",
    });
  }
  if (D > A) {
    context.addIssue({
      code: "custom",
      path: ["dailyAmount"],
      message: "cannot be more than the account amount",
    });
  } else if (D * BigInt(terms.termDays) < A) {
    context.addIssue({
      code: "custom",
      path: ["termDays"],
      message: `${formatPaiseForMessage(D)} × ${terms.termDays} days cannot clear ${formatPaiseForMessage(A)}`,
    });
  }
}

/** The terms an Admin enters (S-04), with BR-01 checked. */
export const accountTermsSchema = z.object(termsShape).superRefine(checkTerms);

const accountRequestSchema = z
  .object({ customerId: idSchema, ...termsShape })
  .superRefine(checkTerms);

export const scheduleSlotSchema = z.object({
  sequence: z.number().int().min(1),
  dueDate: calendarDateSchema,
  expectedAmount: moneyStringSchema,
  status: z.enum(["PENDING", "COLLECTED", "PARTIAL", "MISSED", "CANCELLED"]),
});

export const accountPreviewSchema = z.object({
  /** `MID_TERM` when the disbursement date is before today (US-030a). */
  kind: z.enum(["DAY_ONE", "MID_TERM"]),
  /** P = A − I (BR-01). */
  profitAmount: moneyStringSchema,
  collectedAmount: moneyStringSchema,
  outstandingAmount: moneyStringSchema,
  /** Mid-term only: short of what the original schedule expected by today. */
  amountBehind: moneyStringSchema,
  firstCollectionDate: calendarDateSchema,
  targetCompletionDate: calendarDateSchema,
  /** `ceil(A ÷ D)` — from the balance, not from N (BR-04). */
  slotCount: z.number().int().min(1),
  /** Mid-term: the slots already paid keep their dates as COLLECTED / PARTIAL. */
  slots: z.array(scheduleSlotSchema),
  /** Declared holidays the schedule steps over, for the preview to name. */
  holidaysSkipped: z.array(
    z.object({ date: calendarDateSchema, name: z.string() }),
  ),
});

export const accountSchema = z.object({
  id: idSchema,
  accountCode: z.string(),
  customerId: idSchema,
  customerName: z.string(),
  lineId: idSchema,
  lineName: z.string(),
  status: accountStatusSchema,
  accountAmount: moneyStringSchema,
  /** `null` for a Junior, who never sees invested amount or profit (RBAC matrix). */
  investedAmount: moneyStringSchema.nullable(),
  profitAmount: moneyStringSchema.nullable(),
  dailyAmount: moneyStringSchema,
  termDays: z.number().int(),
  disbursementDate: calendarDateSchema,
  firstCollectionDate: calendarDateSchema,
  targetCompletionDate: calendarDateSchema,
  actualCompletionDate: calendarDateSchema.nullable(),
  collectedAmount: moneyStringSchema,
  outstandingAmount: moneyStringSchema,
  isOverdue: z.boolean(),
});

const accountParams = z.object({ accountId: idSchema });

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const accountContract = {
  previewAccount: route({
    method: "POST",
    path: "/api/accounts/preview",
    summary:
      "Derived values and the full schedule for proposed terms, saving nothing (S-04)",
    body: accountRequestSchema,
    responses: { 200: accountPreviewSchema, ...errors, 422: errorSchema },
  }),

  createAccount: route({
    method: "POST",
    path: "/api/accounts",
    summary:
      "Create an account, optionally disbursing it at once (US-030, US-032)",
    body: z
      .object({
        customerId: idSchema,
        ...termsShape,
        /** "Save and disburse" (S-04): create and disburse in one transaction. */
        disburse: z.boolean().default(false),
      })
      .superRefine(checkTerms),
    responses: { 201: accountSchema, ...errors, 422: errorSchema },
  }),

  updateAccountTerms: route({
    method: "PATCH",
    path: "/api/accounts/:accountId",
    summary:
      "Correct a PENDING account’s terms before it is disbursed (US-030)",
    pathParams: accountParams,
    /**
     * The whole set of terms, checked exactly as at creation (BR-01). The
     * customer does not change: an account on the wrong customer is cancelled
     * and entered again, not edited.
     */
    // Inline, not `accountTermsSchema`: the exported alias widens the type
    // and the handler then loses `params` and `body`.
    body: z.object(termsShape).superRefine(checkTerms),
    responses: { 200: accountSchema, ...errors, 422: errorSchema },
  }),

  disburseAccount: route({
    method: "POST",
    path: "/api/accounts/:accountId/disbursement",
    summary: "Disburse a PENDING account and post it to the ledger (US-032)",
    pathParams: accountParams,
    responses: { 200: accountSchema, ...errors, 422: errorSchema },
  }),

  closeAccount: route({
    method: "POST",
    path: "/api/accounts/:accountId/closure",
    summary: "Stop collecting on an account, with a reason (US-035)",
    pathParams: accountParams,
    body: z.object({
      /**
       * `DEFAULTED` stops collection and leaves the money owed on the books;
       * `WRITTEN_OFF` also gives it up, and posts the write-off (M09).
       */
      status: z.enum(["DEFAULTED", "WRITTEN_OFF"]),
      /** Mandatory: the closure is a judgement, and it is kept with the account. */
      note: z.string().trim().min(1).max(500),
    }),
    responses: { 200: accountSchema, ...errors, 422: errorSchema },
  }),

  listAccounts: route({
    method: "GET",
    path: "/api/accounts",
    summary: "Accounts visible to the caller, optionally searched (US-024a)",
    query: pageQuerySchema.extend({
      /**
       * Global search (US-024a): any part of the account code — whole
       * (`ACC-2026-00231`), without the year (`00231`) or just its number
       * (`231`) — or any part of the customer's name, in any case.
       */
      q: z
        .string()
        .trim()
        .max(80)
        .optional()
        .transform((value) => (value ? value : undefined)),
      customerId: idSchema.optional(),
      lineId: idSchema.optional(),
      status: accountStatusSchema.optional(),
    }),
    responses: { 200: pageSchema(accountSchema), ...errors },
  }),

  getAccount: route({
    method: "GET",
    path: "/api/accounts/:accountId",
    summary: "One account (S-11)",
    pathParams: accountParams,
    responses: { 200: accountSchema, ...errors },
  }),

  getAccountSchedule: route({
    method: "GET",
    path: "/api/accounts/:accountId/schedule",
    summary: "An account's schedule, in sequence (S-11)",
    pathParams: accountParams,
    responses: {
      200: z.object({ slots: z.array(scheduleSlotSchema) }),
      ...errors,
    },
  }),
} as const;

export type Account = z.infer<typeof accountSchema>;
export type AccountPreview = z.infer<typeof accountPreviewSchema>;
export type ScheduleSlotView = z.infer<typeof scheduleSlotSchema>;
