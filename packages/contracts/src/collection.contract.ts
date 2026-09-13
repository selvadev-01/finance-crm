import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
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
  /** Recorded today already, if so — the row shows it rather than asking again. */
  collectedToday: z
    .object({
      amount: moneyStringSchema,
      classification: classificationSchema,
    })
    .nullable(),
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
} as const;

export type CollectionView = z.infer<typeof collectionSchema>;
export type RouteView = z.infer<typeof routeSchema>;
