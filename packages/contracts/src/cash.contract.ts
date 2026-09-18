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
 * M08 Day close and cash control — closing a line's day (US-060), reopening
 * it (US-055), and moving cash Junior → Senior → office with a denomination
 * count (US-061…US-064).
 */

/** The nine notes and coins counted at every handover. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export const dayCloseStatusSchema = z.enum([
  "OPEN",
  "CLOSED",
  "REOPENED",
  "TALLIED",
]);
export const handoverStatusSchema = z.enum([
  "PENDING",
  "ACKNOWLEDGED",
  "DISPUTED",
]);
export const handoverHopSchema = z.enum([
  "JUNIOR_TO_SENIOR",
  "SENIOR_TO_OFFICE",
]);

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

// ------------------------------------------------------------- phone reports

export const syncReportBodySchema = z.object({
  /** Collections saved on this phone and not yet acknowledged by the server. */
  unsentCount: z.number().int().min(0).max(100_000),
  /** `capturedAt` of the oldest of them; absent when there are none. */
  oldestUnsentAt: z.iso.datetime({ offset: true }).optional(),
});

// ----------------------------------------------------------------- handovers

export const denominationCountSchema = z.object({
  denomination: z.union(DENOMINATIONS.map((value) => z.literal(value))),
  count: z.number().int().min(0).max(100_000),
});

export const handoverSchema = z.object({
  id: idSchema,
  hop: handoverHopSchema,
  lineId: idSchema,
  lineName: z.string(),
  businessDate: calendarDateSchema,
  fromUserId: idSchema,
  fromName: z.string(),
  toUserId: idSchema,
  toName: z.string(),
  /** Σ denomination × count. */
  declaredAmount: moneyStringSchema,
  /** What Rasi recorded for the sender and date, less earlier handovers. */
  systemAmount: moneyStringSchema,
  /** declared − system. */
  discrepancy: signedMoneyStringSchema,
  status: handoverStatusSchema,
  note: z.string().nullable(),
  disputeNote: z.string().nullable(),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  denominations: z.array(
    z.object({
      denomination: z.number().int(),
      count: z.number().int(),
      subtotal: moneyStringSchema,
    }),
  ),
  /** The caller is the receiver and it is pending. */
  canAcknowledge: z.boolean(),
  /** Pending, and the caller is a party to it or an Admin. */
  canDispute: z.boolean(),
});

export const handOverBodySchema = z.object({
  lineId: idSchema,
  businessDate: calendarDateSchema,
  /** The receiving Admin on the office hop; the line's Senior is found for a Junior. */
  toUserId: idSchema.optional(),
  counts: z.array(denominationCountSchema).max(DENOMINATIONS.length),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/** What the caller holds and can hand over, per line and business date. */
export const cashPositionSchema = z.object({
  items: z.array(
    z.object({
      lineId: idSchema,
      lineName: z.string(),
      businessDate: calendarDateSchema,
      hop: handoverHopSchema,
      /** Recorded and not yet covered by an acknowledged handover. */
      toHandOver: moneyStringSchema,
      /** The line's Senior for a Junior; null on the office hop (the Senior picks). */
      receiver: z.object({ userId: idSchema, name: z.string() }).nullable(),
      pending: handoverSchema.nullable(),
    }),
  ),
  /** Who a Senior may hand the office's cash to. Empty for a Junior. */
  officeReceivers: z.array(z.object({ userId: idSchema, name: z.string() })),
  /** Recent handovers the caller sent, newest first. */
  recent: z.array(handoverSchema),
});

// ----------------------------------------------------------------- day close

export const juniorSyncSchema = z.object({
  userId: idSchema,
  name: z.string(),
  collectedAmount: signedMoneyStringSchema,
  entries: z.number().int(),
  /**
   * From the phone's last report: `SENT` nothing waiting; `UNSENT` some still
   * on the phone; `NOT_HEARD` no report today.
   */
  sync: z.enum(["SENT", "UNSENT", "NOT_HEARD"]),
  unsentCount: z.number().int().nullable(),
  reportedAt: z.string().nullable(),
});

export const dayCloseSchema = z.object({
  lineId: idSchema,
  lineName: z.string(),
  businessDate: calendarDateSchema,
  day: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("WORKING") }),
    z.object({ kind: z.literal("SUNDAY") }),
    z.object({ kind: z.literal("HOLIDAY"), name: z.string() }),
  ]),
  /** `OPEN` when the day has no close yet. */
  status: dayCloseStatusSchema,
  /** Σ expected of the line's slots due that date (BR-16). */
  expectedTotal: moneyStringSchema,
  /** Σ confirmed collections on the line that date, adjustments included. */
  collectedTotal: signedMoneyStringSchema,
  /** Σ acknowledged Junior → Senior handovers. */
  cashReceivedTotal: moneyStringSchema,
  /** cashReceived − collected. */
  discrepancy: signedMoneyStringSchema,
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  reopenReason: z.string().nullable(),
  juniors: z.array(juniorSyncSchema),
  /** Every LOW, EXTRA, NO_PAYMENT collection and MISSED (or still pending) slot. */
  exceptions: z.array(
    z.object({
      kind: z.enum(["LOW", "EXTRA", "NO_PAYMENT", "MISSED", "NOT_VISITED"]),
      collectionId: idSchema.nullable(),
      accountLoanId: idSchema,
      accountCode: z.string(),
      customerName: z.string(),
      expectedAmount: moneyStringSchema,
      amount: moneyStringSchema.nullable(),
      collectedByName: z.string().nullable(),
    }),
  ),
  handovers: z.array(handoverSchema),
  canClose: z.boolean(),
  canReopen: z.boolean(),
});

const dayParams = z.object({
  lineId: idSchema,
  businessDate: calendarDateSchema,
});
const handoverParams = z.object({ handoverId: idSchema });

export const cashContract = {
  reportSync: route({
    method: "POST",
    path: "/api/devices/sync-report",
    summary:
      "A Junior's phone reports how many collections it still holds (US-060)",
    body: syncReportBodySchema,
    responses: { 200: z.object({ reportedAt: z.string() }), ...errors },
  }),

  getDayClose: route({
    method: "GET",
    path: "/api/lines/:lineId/day-closes/:businessDate",
    summary:
      "A line's day: totals, Juniors' sync, exceptions and handovers (S-05)",
    pathParams: dayParams,
    responses: { 200: dayCloseSchema, ...errors },
  }),

  closeDay: route({
    method: "POST",
    path: "/api/lines/:lineId/day-closes/:businessDate/close",
    summary:
      "Close a line's day, marking unvisited slots MISSED (US-060, US-043)",
    pathParams: dayParams,
    body: z.object({
      /** Close even though some Juniors' phones still hold collections. */
      confirmUnsynced: z.boolean().optional(),
    }),
    responses: {
      200: dayCloseSchema,
      ...errors,
      /** Already closed, or phones still hold collections and it was not confirmed. */
      409: errorSchema,
      422: errorSchema,
    },
  }),

  reopenDay: route({
    method: "POST",
    path: "/api/lines/:lineId/day-closes/:businessDate/reopen",
    summary: "Reopen a closed day, with a reason (BR-16)",
    pathParams: dayParams,
    body: z.object({
      reason: z.string().trim().min(1, "a reason is required").max(500),
    }),
    responses: { 200: dayCloseSchema, ...errors, 409: errorSchema },
  }),

  getCashPosition: route({
    method: "GET",
    path: "/api/cash",
    summary:
      "The caller's cash to hand over, and their recent handovers (S-06)",
    responses: { 200: cashPositionSchema, ...errors },
  }),

  handOver: route({
    method: "POST",
    path: "/api/handovers",
    summary:
      "Hand cash over with a denomination count; a discrepancy is recorded, never blocked (US-061, US-064)",
    body: handOverBodySchema,
    responses: {
      201: handoverSchema,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  listHandovers: route({
    method: "GET",
    path: "/api/handovers",
    summary: "Handovers addressed to the caller, pending first (US-062)",
    query: z.object({ status: handoverStatusSchema.optional() }),
    responses: { 200: z.object({ data: z.array(handoverSchema) }), ...errors },
  }),

  acknowledgeHandover: route({
    method: "POST",
    path: "/api/handovers/:handoverId/acknowledge",
    summary:
      "The receiver confirms the cash arrived; the ledger posts it (US-062, BR-17)",
    pathParams: handoverParams,
    body: z.object({}),
    responses: { 200: handoverSchema, ...errors, 409: errorSchema },
  }),

  disputeHandover: route({
    method: "POST",
    path: "/api/handovers/:handoverId/dispute",
    summary: "Dispute a pending handover with a note (US-063)",
    pathParams: handoverParams,
    body: z.object({
      note: z.string().trim().min(1, "say what is wrong").max(500),
    }),
    responses: { 200: handoverSchema, ...errors, 409: errorSchema },
  }),
} as const;

export type Handover = z.infer<typeof handoverSchema>;
export type CashPosition = z.infer<typeof cashPositionSchema>;
export type DayCloseView = z.infer<typeof dayCloseSchema>;
export type JuniorSync = z.infer<typeof juniorSyncSchema>;
