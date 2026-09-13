import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M01 Identity — staff administration (US-003, and US-092 as it lands).
 */
export const passwordResetSchema = z.object({
  /**
   * Shown to the Admin once, to pass on in person or by phone. Never stored in
   * plain text, logged or audited. The staff member must replace it at their
   * next sign-in.
   */
  temporaryPassword: z.string(),
  /** Sessions revoked on every device the staff member was signed in on. */
  sessionsRevoked: z.number().int().min(0),
});

export const meSchema = z.object({
  userId: idSchema,
  staffProfileId: idSchema,
  name: z.string(),
  email: z.string(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "SENIOR", "JUNIOR"]),
  /** The line in effect today, if any. */
  currentLineId: idSchema.nullable(),
});

const roleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "SENIOR", "JUNIOR"]);
const statusSchema = z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]);

/** The line a staff member works today, if any (date-aware, M02). */
export const currentAssignmentSchema = z.object({
  assignmentId: idSchema,
  lineId: idSchema,
  lineCode: z.string(),
  lineName: z.string(),
  assignmentRole: z.enum(["SENIOR", "JUNIOR"]),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});

/** One row of the Team list (S-14, US-014). */
export const staffSummarySchema = z.object({
  staffProfileId: idSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  staffCode: z.string(),
  role: roleSchema,
  status: statusSchema,
  joinedAt: calendarDateSchema,
  currentAssignment: currentAssignmentSchema.nullable(),
});

/** A staff member with the assignments the caller may see (S-14, US-015). */
export const staffDetailSchema = staffSummarySchema.extend({
  /** Newest first. A Senior sees only rows on their own line. */
  assignments: z.array(
    currentAssignmentSchema.extend({
      /** Starts after today — scheduled, not yet in effect. */
      upcoming: z.boolean(),
    }),
  ),
});

export const staffContract = {
  listStaff: route({
    method: "GET",
    path: "/api/staff",
    summary:
      "Staff visible to the caller, with the line each works today (S-14)",
    query: pageQuerySchema.extend({
      role: roleSchema.optional(),
      status: statusSchema.optional(),
    }),
    responses: {
      200: pageSchema(staffSummarySchema),
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),

  getStaff: route({
    method: "GET",
    path: "/api/staff/:staffProfileId",
    summary: "One staff member with their assignment history (S-14, US-015)",
    pathParams: z.object({ staffProfileId: idSchema }),
    responses: {
      200: staffDetailSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
    },
  }),

  me: route({
    method: "GET",
    path: "/api/me",
    summary:
      "The signed-in staff member — role landing and forced password change (US-001, US-003)",
    responses: {
      200: meSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),

  resetStaffPassword: route({
    method: "POST",
    path: "/api/staff/:staffProfileId/password-reset",
    summary:
      "Admin-initiated password reset for staff without email access (US-003)",
    pathParams: z.object({ staffProfileId: idSchema }),
    responses: {
      201: passwordResetSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
    },
  }),
} as const;

export type PasswordReset = z.infer<typeof passwordResetSchema>;
export type Me = z.infer<typeof meSchema>;
export type StaffSummary = z.infer<typeof staffSummarySchema>;
export type StaffDetail = z.infer<typeof staffDetailSchema>;
