import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  codeSchema,
  errorSchema,
  idSchema,
  nameSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M03 Organisation — sectors, lines, and staff assignment (US-010…US-013).
 */

export const sectorSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

export const lineSchema = z.object({
  id: idSchema,
  sectorId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

export const assignmentSchema = z.object({
  id: idSchema,
  lineId: idSchema,
  staffProfileId: idSchema,
  assignmentRole: z.enum(["SENIOR", "JUNIOR"]),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});

export const lineStaffingSchema = z.object({
  lineId: idSchema,
  code: z.string(),
  name: z.string(),
  sectorId: idSchema,
  /** The Senior in effect today, if any. */
  senior: z.object({ staffProfileId: idSchema, name: z.string() }).nullable(),
  juniorCount: z.number().int().min(0),
  customerCount: z.number().int().min(0),
});

export const assignmentHistoryEntrySchema = assignmentSchema.extend({
  staffName: z.string(),
});

const sectorParams = z.object({ sectorId: idSchema });
const lineParams = z.object({ lineId: idSchema });

const assignmentRequest = z.object({
  staffProfileId: idSchema,
  /** Explicit — the UI never implies "now" (M03). */
  effectiveFrom: calendarDateSchema,
});

const assignmentResult = z.object({
  assignment: assignmentSchema,
  /** Assignments closed by this change, with their new `effectiveTo`. */
  closed: z.array(assignmentSchema),
  /**
   * Lines left with no Senior because their Senior moved here (decided
   * 2026-09-13: the move is allowed, and reported).
   */
  linesWithoutSenior: z.array(idSchema),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

/**
 * US-040: a line's current customers in visiting order. `position` is null
 * for a customer not yet placed; those come last, in customer-code order.
 */
export const visitingOrderSchema = z.object({
  customers: z.array(
    z.object({
      customerId: idSchema,
      customerCode: z.string(),
      name: z.string(),
      address: z.string(),
      position: z.number().int().min(1).nullable(),
    }),
  ),
});

export const organisationContract = {
  listSectors: route({
    method: "GET",
    path: "/api/sectors",
    summary: "Sectors visible to the caller",
    query: pageQuerySchema.extend({
      includeInactive: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    }),
    responses: { 200: pageSchema(sectorSchema), ...errors },
  }),

  getSector: route({
    method: "GET",
    path: "/api/sectors/:sectorId",
    summary: "One sector the caller can see, active or not (S-13)",
    pathParams: sectorParams,
    responses: { 200: sectorSchema, ...errors },
  }),

  createSector: route({
    method: "POST",
    path: "/api/sectors",
    summary: "Create a sector (US-010)",
    body: z.object({ code: codeSchema, name: nameSchema }),
    responses: { 201: sectorSchema, ...errors, 409: errorSchema },
  }),

  updateSector: route({
    method: "PATCH",
    path: "/api/sectors/:sectorId",
    summary: "Rename a sector (US-010)",
    pathParams: sectorParams,
    body: z.object({ name: nameSchema }),
    responses: { 200: sectorSchema, ...errors },
  }),

  deactivateSector: route({
    method: "POST",
    path: "/api/sectors/:sectorId/deactivation",
    summary: "Deactivate a sector with no active lines (US-010)",
    pathParams: sectorParams,
    responses: { 200: sectorSchema, ...errors, 422: errorSchema },
  }),

  listLines: route({
    method: "GET",
    path: "/api/lines",
    summary: "Lines visible to the caller",
    query: pageQuerySchema.extend({
      sectorId: idSchema.optional(),
      includeInactive: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    }),
    responses: { 200: pageSchema(lineSchema), ...errors },
  }),

  getLine: route({
    method: "GET",
    path: "/api/lines/:lineId",
    summary: "One line the caller can see, active or not (S-12)",
    pathParams: lineParams,
    responses: { 200: lineSchema, ...errors },
  }),

  createLine: route({
    method: "POST",
    path: "/api/lines",
    summary: "Create a line within an active sector (US-011)",
    body: z.object({ sectorId: idSchema, code: codeSchema, name: nameSchema }),
    responses: {
      201: lineSchema,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  updateLine: route({
    method: "PATCH",
    path: "/api/lines/:lineId",
    summary: "Rename a line (US-011)",
    pathParams: lineParams,
    body: z.object({ name: nameSchema }),
    responses: { 200: lineSchema, ...errors },
  }),

  deactivateLine: route({
    method: "POST",
    path: "/api/lines/:lineId/deactivation",
    summary: "Deactivate a line with no ACTIVE accounts (US-011)",
    pathParams: lineParams,
    responses: { 200: lineSchema, ...errors, 422: errorSchema },
  }),

  assignSenior: route({
    method: "POST",
    path: "/api/lines/:lineId/senior-assignment",
    summary: "Assign a Senior, closing the incumbent (US-012)",
    pathParams: lineParams,
    body: assignmentRequest,
    responses: {
      201: assignmentResult,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  listLineStaffing: route({
    method: "GET",
    path: "/api/staffing",
    summary: "Who is on which line today: Senior, Juniors, customers (US-014)",
    query: pageQuerySchema,
    responses: { 200: pageSchema(lineStaffingSchema), ...errors },
  }),

  listAssignmentHistory: route({
    method: "GET",
    path: "/api/lines/:lineId/assignments",
    summary:
      "A line's assignment history, or who was responsible on a date (US-015)",
    pathParams: lineParams,
    query: pageQuerySchema.extend({
      /** Only the assignments in effect on this date. */
      on: calendarDateSchema.optional(),
    }),
    responses: { 200: pageSchema(assignmentHistoryEntrySchema), ...errors },
  }),

  assignJunior: route({
    method: "POST",
    path: "/api/lines/:lineId/junior-assignment",
    summary: "Assign or move a Junior to this line (US-013)",
    pathParams: lineParams,
    body: assignmentRequest,
    responses: {
      201: assignmentResult,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  getVisitingOrder: route({
    method: "GET",
    path: "/api/lines/:lineId/visiting-order",
    summary:
      "The line's customers in the order the Junior visits them (US-040)",
    pathParams: lineParams,
    responses: { 200: visitingOrderSchema, ...errors },
  }),

  setVisitingOrder: route({
    method: "POST",
    path: "/api/lines/:lineId/visiting-order",
    summary:
      "Replace the line's visiting order; every current customer, once (US-040)",
    pathParams: lineParams,
    body: z.object({
      /** Every current customer of the line, first visit first. */
      customerIds: z.array(idSchema).max(2000),
    }),
    responses: { 200: visitingOrderSchema, ...errors, 422: errorSchema },
  }),
} as const;

export type Sector = z.infer<typeof sectorSchema>;
export type Line = z.infer<typeof lineSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type LineStaffing = z.infer<typeof lineStaffingSchema>;
export type VisitingOrder = z.infer<typeof visitingOrderSchema>;
export type AssignmentHistoryEntry = z.infer<
  typeof assignmentHistoryEntrySchema
>;
