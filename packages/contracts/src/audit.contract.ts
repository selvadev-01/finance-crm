import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  pageQuerySchema,
} from "./shared.js";

/**
 * M13 Audit — the audit log (US-090) and an account's history (US-091). Both
 * are read-only and for Admins and Super Admins: the log records everyone's
 * actions, and showing it to Seniors and Juniors would reveal other staff
 * members' activity.
 */

export const AUDITED_TABLES = [
  "user",
  "staff_profile",
  "sector",
  "line",
  "line_assignment",
  "customer",
  "account_loan",
  "collection",
  "day_close",
  "cash_handover",
  "ledger_account",
  "holiday",
] as const;

export const auditActionSchema = z.enum([
  "CREATE",
  "UPDATE",
  "DELETE",
  "APPROVE",
  "REJECT",
  "LOGIN",
  "REOPEN_DAY",
]);

const snapshotSchema = z.record(z.string(), z.unknown()).nullable();
const personSchema = z.object({ userId: z.string(), name: z.string() });

export const auditEntrySchema = z.object({
  id: idSchema,
  createdAt: z.string(),
  action: auditActionSchema,
  entityTable: z.string(),
  entityId: z.string(),
  /** Who did it; null for a system action or a sign-in with an unknown email. */
  actor: personSchema.nullable(),
  /** A scheduled job or an automatic change rather than a person. */
  system: z.boolean(),
  before: snapshotSchema,
  after: snapshotSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

const accountParams = z.object({ accountId: idSchema });

/** One step in an account's life, newest last (US-091). */
export const accountHistoryEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("AUDIT"),
    at: z.string(),
    entry: auditEntrySchema,
  }),
  z.object({
    kind: z.literal("COLLECTION"),
    at: z.string(),
    collectionId: idSchema,
    businessDate: calendarDateSchema,
    entryType: z.enum(["ORIGINAL", "ADJUSTMENT"]),
    adjustsCollectionId: z.string().nullable(),
    amount: z.string(),
    expectedAmount: z.string(),
    variance: z.string(),
    classification: z.enum(["CORRECT", "LOW", "EXTRA", "NO_PAYMENT"]),
    status: z.enum(["PENDING_APPROVAL", "CONFIRMED", "REVERSED", "REJECTED"]),
    collector: personSchema,
    note: z.string().nullable(),
    approval: z
      .object({
        decision: z.enum(["PENDING", "APPROVED", "REJECTED"]),
        reason: z.string(),
        requestedBy: personSchema,
        decidedBy: personSchema.nullable(),
        decisionNote: z.string().nullable(),
        decidedAt: z.string().nullable(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal("DAY_CLOSE"),
    at: z.string(),
    businessDate: calendarDateSchema,
    lineId: idSchema,
    lineName: z.string(),
    status: z.enum(["OPEN", "CLOSED", "REOPENED", "TALLIED"]),
    expectedTotal: z.string(),
    collectedTotal: z.string(),
    discrepancy: z.string(),
    closedBy: personSchema.nullable(),
    reopenReason: z.string().nullable(),
  }),
]);

export const auditContract = {
  listAuditLog: route({
    method: "GET",
    path: "/api/audit-log",
    summary:
      "The organization's audit log, newest first, filtered by actor, entity, action and date (US-090)",
    query: pageQuerySchema.extend({
      actorUserId: z.string().min(1).max(64).optional(),
      entityTable: z.enum(AUDITED_TABLES).optional(),
      entityId: z.string().min(1).max(64).optional(),
      action: auditActionSchema.optional(),
      /** Business dates, inclusive, in the business time zone. */
      from: calendarDateSchema.optional(),
      to: calendarDateSchema.optional(),
    }),
    responses: {
      200: z.object({
        data: z.array(auditEntrySchema),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      }),
      ...errors,
    },
  }),

  getAccountHistory: route({
    method: "GET",
    path: "/api/accounts/:accountId/history",
    summary:
      "An account's full chronological trail: audit entries, collections with corrections and approvals, and day closes (US-091)",
    pathParams: accountParams,
    responses: {
      200: z.object({
        account: z.object({
          id: idSchema,
          accountCode: z.string(),
          customerName: z.string(),
          status: z.enum([
            "PENDING",
            "ACTIVE",
            "COMPLETED",
            "DEFAULTED",
            "WRITTEN_OFF",
          ]),
          actualCompletionDate: calendarDateSchema.nullable(),
        }),
        events: z.array(accountHistoryEventSchema),
      }),
      ...errors,
    },
  }),
} as const;

export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditedTable = (typeof AUDITED_TABLES)[number];
export type AccountHistoryEvent = z.infer<typeof accountHistoryEventSchema>;
