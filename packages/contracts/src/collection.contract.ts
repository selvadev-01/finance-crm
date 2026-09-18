import { z } from "zod";

import { accountStatusSchema } from "./account.contract.js";
import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  pageQuerySchema,
  pageSchema,
  signedMoneyStringSchema,
} from "./shared.js";

/**
 * M07 Collections — recording money at the door (US-041, US-053) and the
 * Junior's route (US-040).
 */

export const classificationSchema = z.enum([
  "CORRECT",
  "LOW",
  "EXTRA",
  "NO_PAYMENT",
]);

export const collectionSchema = z.object({
  id: idSchema,
  idempotencyKey: z.string(),
  accountLoanId: idSchema,
  accountScheduleId: idSchema.nullable(),
  /** Frozen at write (BR-15). */
  lineId: idSchema,
  collectedByUserId: idSchema,
  /** Asia/Kolkata, from `capturedAt` (BR-12). */
  businessDate: calendarDateSchema,
  capturedAt: z.string(),
  syncedAt: z.string(),
  /** `min(D, outstanding)` when recorded (BR-07), frozen. */
  expectedAmount: moneyStringSchema,
  amount: moneyStringSchema,
  variance: signedMoneyStringSchema,
  classification: classificationSchema,
  note: z.string().nullable(),
  /** The account as this collection left it. No invested amount or profit. */
  account: z.object({
    status: z.enum(["ACTIVE", "COMPLETED"]),
    collectedAmount: moneyStringSchema,
    outstandingAmount: moneyStringSchema,
    targetCompletionDate: calendarDateSchema,
    actualCompletionDate: calendarDateSchema.nullable(),
  }),
});

export const recordCollectionBodySchema = z.object({
  /**
   * UUID generated **on the device when the collection is recorded**, before
   * any network attempt, and reused for every retry (BR-13, US-053).
   */
  idempotencyKey: z.uuid(),
  /** Mandatory and never inferred from the customer (BR-01a). */
  accountLoanId: idSchema,
  /** `0` is a visit with nothing paid — NO_PAYMENT (BR-09). */
  amount: moneyStringSchema,
  /** Device clock when recorded, with its offset. */
  capturedAt: z.iso.datetime({ offset: true }),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const routeAccountSchema = z.object({
  accountLoanId: idSchema,
  accountCode: z.string(),
  /** `min(D, outstanding)` (BR-07) — what to ask for today. */
  expectedAmount: moneyStringSchema,
  outstandingAmount: moneyStringSchema,
  dailyAmount: moneyStringSchema,
  /** Pending schedule slots, today's included (S-02). */
  daysRemaining: z.number().int().nonnegative(),
  /** Recorded today already, if so — the row shows it rather than asking again. */
  collectedToday: z
    .object({
      amount: moneyStringSchema,
      classification: classificationSchema,
    })
    .nullable(),
  /**
   * Idempotency keys of today's collections on this account that these figures
   * already include. The device applies a queued collection on top of the
   * route only when its key is not here, so a refresh that races a sync never
   * subtracts the same money twice (offline-sync.md#balances-update-locally).
   */
  includedKeys: z.array(z.string()),
});

export const routeSchema = z.object({
  businessDate: calendarDateSchema,
  /** US-040 and S-01: three different empty days, never one message. */
  day: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("WORKING") }),
    z.object({ kind: z.literal("SUNDAY") }),
    z.object({ kind: z.literal("HOLIDAY"), name: z.string() }),
  ]),
  /** `null` when the Junior has no line today. */
  lineId: idSchema.nullable(),
  customers: z.array(
    z.object({
      customerId: idSchema,
      customerCode: z.string(),
      name: z.string(),
      address: z.string(),
      mobile: z.string(),
      /** One per account due today; several means an explicit split (US-042). */
      accounts: z.array(routeAccountSchema),
    }),
  ),
});

// ------------------------------------------------------ history and corrections

/** `REJECTED`: a correction the approver refused — never applied (US-044). */
export const collectionStatusSchema = z.enum([
  "PENDING_APPROVAL",
  "CONFIRMED",
  "REVERSED",
  "REJECTED",
]);
export const entryTypeSchema = z.enum(["ORIGINAL", "ADJUSTMENT"]);
export const approvalDecisionSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

/** S-16: one row of collection history. An adjustment's amount is signed. */
export const collectionListItemSchema = z.object({
  id: idSchema,
  entryType: entryTypeSchema,
  status: collectionStatusSchema,
  /** The collection an ADJUSTMENT corrects. */
  adjustsCollectionId: idSchema.nullable(),
  accountLoanId: idSchema,
  accountCode: z.string(),
  customerId: idSchema,
  customerName: z.string(),
  /** Frozen at write (BR-15). */
  lineId: idSchema,
  lineName: z.string(),
  collectedByUserId: idSchema,
  collectedByName: z.string(),
  businessDate: calendarDateSchema,
  capturedAt: z.string(),
  syncedAt: z.string(),
  /** `0.00` on an adjustment, which is not measured against a slot. */
  expectedAmount: moneyStringSchema,
  amount: signedMoneyStringSchema,
  variance: signedMoneyStringSchema,
  /** On an adjustment: how the corrected collection now classifies. */
  classification: classificationSchema,
  note: z.string().nullable(),
});

export const approvalSchema = z.object({
  id: idSchema,
  decision: approvalDecisionSchema,
  reason: z.string(),
  requestedByUserId: idSchema,
  requestedByName: z.string(),
  requestedAt: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /**
   * Whether the caller may decide it: pending, within their scope and
   * permission, and **not their own request** (self-approval is blocked).
   */
  canDecide: z.boolean(),
});

/** S-17: a collection with its adjustments and approval trail. */
export const collectionDetailSchema = collectionListItemSchema.extend({
  /** Present on an ADJUSTMENT. */
  approval: approvalSchema.nullable(),
  /** Adjustments of this collection, oldest first, each with its approval. */
  adjustments: z.array(
    collectionListItemSchema.extend({ approval: approvalSchema.nullable() }),
  ),
  /** The original plus its CONFIRMED adjustments (BR-14). */
  netAmount: signedMoneyStringSchema,
  account: z.object({
    status: accountStatusSchema,
    outstandingAmount: moneyStringSchema,
  }),
  /** What the caller may start from here. */
  canRequestCorrection: z.boolean(),
  canReverse: z.boolean(),
});

/** S-18: a correction waiting for — or given — a decision. */
export const approvalQueueItemSchema = approvalSchema.extend({
  adjustment: collectionListItemSchema,
  /** The collection being corrected, as recorded. */
  original: z.object({
    id: idSchema,
    amount: moneyStringSchema,
    businessDate: calendarDateSchema,
    classification: classificationSchema,
    /** Before this correction: the original plus confirmed adjustments. */
    netAmount: signedMoneyStringSchema,
  }),
  /** The collection's net once approved. */
  correctedAmount: moneyStringSchema,
});

const collectionParams = z.object({ collectionId: idSchema });
const reasonSchema = z.string().trim().min(1, "a reason is required").max(500);

export const requestCorrectionBodySchema = z.object({
  /** What was actually collected — the collection's net once approved. */
  correctedAmount: moneyStringSchema,
  reason: reasonSchema,
});

export const decideApprovalBodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const historyErrors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const collectionContract = {
  recordCollection: route({
    method: "POST",
    path: "/api/collections",
    summary:
      "Record a collection against one account, safe to replay (US-041, US-053)",
    body: recordCollectionBodySchema,
    responses: {
      201: collectionSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      /** The key was used for a different collection — a client bug. */
      409: errorSchema,
      422: errorSchema,
    },
    replayStatus: 200,
  }),

  getRoute: route({
    method: "GET",
    path: "/api/route",
    summary: "The signed-in Junior's route for today (US-040)",
    responses: {
      200: routeSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),

  listCollections: route({
    method: "GET",
    path: "/api/collections",
    summary:
      "Collection history in the caller's scope, date-bounded (S-16, US-045)",
    query: pageQuerySchema.extend({
      /** Inclusive business dates, at most 93 days apart. */
      from: calendarDateSchema,
      to: calendarDateSchema,
      lineId: idSchema.optional(),
      accountLoanId: idSchema.optional(),
      entryType: entryTypeSchema.optional(),
      status: collectionStatusSchema.optional(),
    }),
    responses: { 200: pageSchema(collectionListItemSchema), ...historyErrors },
  }),

  getCollection: route({
    method: "GET",
    path: "/api/collections/:collectionId",
    summary: "One collection with its adjustments and approvals (S-17)",
    pathParams: collectionParams,
    responses: { 200: collectionDetailSchema, ...historyErrors },
  }),

  requestCorrection: route({
    method: "POST",
    path: "/api/collections/:collectionId/corrections",
    summary:
      "Ask for a collection to be corrected; applies only on approval (US-044, BR-14)",
    pathParams: collectionParams,
    body: requestCorrectionBodySchema,
    responses: {
      201: approvalQueueItemSchema,
      ...historyErrors,
      /** A correction of this collection is already waiting. */
      409: errorSchema,
      422: errorSchema,
    },
  }),

  requestReversal: route({
    method: "POST",
    path: "/api/collections/:collectionId/reversal",
    summary:
      "Ask for a collection to be reversed to ₹0; applies only on approval (BR-14)",
    pathParams: collectionParams,
    body: z.object({ reason: reasonSchema }),
    responses: {
      201: approvalQueueItemSchema,
      ...historyErrors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  listApprovals: route({
    method: "GET",
    path: "/api/collection-approvals",
    summary: "Corrections in the caller's scope, pending by default (S-18)",
    query: pageQuerySchema.extend({
      decision: approvalDecisionSchema.default("PENDING"),
    }),
    responses: { 200: pageSchema(approvalQueueItemSchema), ...historyErrors },
  }),

  decideApproval: route({
    method: "POST",
    path: "/api/collection-approvals/:approvalId/decision",
    summary: "Approve or reject a correction — never one's own (US-044)",
    pathParams: z.object({ approvalId: idSchema }),
    body: decideApprovalBodySchema,
    responses: {
      200: approvalQueueItemSchema,
      ...historyErrors,
      /** Already decided. */
      409: errorSchema,
      422: errorSchema,
    },
  }),
} as const;

export type CollectionView = z.infer<typeof collectionSchema>;
export type RouteView = z.infer<typeof routeSchema>;
export type CollectionListItem = z.infer<typeof collectionListItemSchema>;
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type ApprovalQueueItem = z.infer<typeof approvalQueueItemSchema>;
