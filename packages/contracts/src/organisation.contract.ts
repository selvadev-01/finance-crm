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
} as const;

export type Sector = z.infer<typeof sectorSchema>;
export type Line = z.infer<typeof lineSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
