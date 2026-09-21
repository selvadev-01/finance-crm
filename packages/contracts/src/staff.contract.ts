import { z } from "zod";

import { mobileSchema } from "./customer.contract.js";
import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  nameSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M01 Identity — staff administration (US-003, US-014, US-015, US-092).
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
  /** The caller's organization; its sign-in link is `/<slug>/sign-in` (US-006). */
  organization: z.object({
    name: z.string(),
    slug: z.string(),
    /**
     * `account.defaultTermDays` in force (M15, US-094) — what the account
     * form starts N at. Forward-only: an existing account keeps the term it
     * was created with, because its schedule was generated from it.
     */
    defaultTermDays: z.number().int().min(1).max(1000),
  }),
});

export const staffRoleSchema = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "SENIOR",
  "JUNIOR",
]);
export const staffStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]);

const roleSchema = staffRoleSchema;
const statusSchema = staffStatusSchema;

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
  /** The sign-in user, as audit entries record the actor (US-090). */
  userId: idSchema,
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

/**
 * US-092 — creating a staff member. Public sign-up is disabled (M01), so this
 * is the only way a staff account comes to exist besides an organization's
 * owner (ADR-0012). The password is never chosen here: the API issues a
 * temporary one and the staff member replaces it at their first sign-in,
 * through the same forced-change flow an Admin reset uses (US-003).
 */
export const createStaffSchema = z.object({
  name: nameSchema,
  /** Stored lower-case, as Better Auth compares it at sign-in. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("must be an email address").max(254)),
  phone: mobileSchema,
  role: roleSchema,
  /** Defaults to today's business date. Never in the future. */
  joinedAt: calendarDateSchema.optional(),
});

export const staffCreatedSchema = z.object({
  staff: staffDetailSchema,
  /** Shown once, exactly as a password reset shows one (US-003). */
  temporaryPassword: z.string(),
});

/** What an Admin may correct on a staff record. Role and status have their own routes. */
export const updateStaffSchema = z.object({
  name: nameSchema,
  phone: mobileSchema,
});

/** What stands between a staff member and losing their access (US-092). */
export const staffDutySchema = z.object({
  /** The line assignment still open or starting later, if any. */
  openAssignment: currentAssignmentSchema.nullable(),
  /** Collections saved on their phone and not yet received (M08 sync report). */
  unsyncedWork: z
    .object({
      unsentCount: z.number().int().min(0),
      oldestUnsentAt: z.string().nullable(),
      reportedAt: z.string(),
    })
    .nullable(),
});

export const staffStatusChangeSchema = staffDutySchema.extend({
  staff: staffDetailSchema,
  /** Sessions deleted because the staff member stopped being ACTIVE. */
  sessionsRevoked: z.number().int().min(0),
});

/**
 * What a soft delete removed (US-092). The record itself stays: their
 * collections, handovers and audit entries name them, and history that loses
 * its actor is not history.
 */
export const staffDeletionSchema = z.object({
  staffProfileId: idSchema,
  name: z.string(),
  deletedAt: z.string(),
  /** Sessions deleted with them: they can never sign in again. */
  sessionsRevoked: z.number().int().min(0),
});

export const staffContract = {
  listStaff: route({
    method: "GET",
    path: "/api/staff",
    summary:
      "Staff visible to the caller, with the line each works today (S-14)",
    query: pageQuerySchema.extend({
      /**
       * Global search (US-024a): any part of the name, the staff code, the
       * email or the phone, in any case. Staff codes carry a random suffix,
       * so there is nothing exact to match on.
       */
      q: z
        .string()
        .trim()
        .max(80)
        .optional()
        .transform((value) => (value ? value : undefined)),
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

  createStaff: route({
    method: "POST",
    path: "/api/staff",
    summary:
      "Create a staff member with a temporary password, shown once (US-092)",
    body: createStaffSchema,
    responses: {
      201: staffCreatedSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  updateStaff: route({
    method: "PATCH",
    path: "/api/staff/:staffProfileId",
    summary: "Correct a staff member's name or mobile number (US-092)",
    pathParams: z.object({ staffProfileId: idSchema }),
    body: updateStaffSchema,
    responses: {
      200: staffDetailSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  changeStaffRole: route({
    method: "POST",
    path: "/api/staff/:staffProfileId/role",
    summary:
      "Change a staff member's role — Super Admin only, never their own (US-092)",
    pathParams: z.object({ staffProfileId: idSchema }),
    body: z.object({ role: roleSchema }),
    responses: {
      200: staffDetailSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
    },
  }),

  deleteStaff: route({
    method: "DELETE",
    path: "/api/staff/:staffProfileId",
    summary:
      "Soft-delete a staff member who has left, keeping their history (US-092)",
    pathParams: z.object({ staffProfileId: idSchema }),
    responses: {
      200: staffDeletionSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
    },
  }),

  changeStaffStatus: route({
    method: "POST",
    path: "/api/staff/:staffProfileId/status",
    summary:
      "Suspend, deactivate or reactivate a staff member — never their own (US-092)",
    pathParams: z.object({ staffProfileId: idSchema }),
    body: z.object({
      status: statusSchema,
      /**
       * Proceed although the staff member is still on duty — an open line
       * assignment, or collections still on their phone. Without it such a
       * change is refused, so losing either is never silent.
       */
      acknowledgeOnDuty: z.boolean().default(false),
    }),
    responses: {
      200: staffStatusChangeSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
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
export type StaffDeletion = z.infer<typeof staffDeletionSchema>;
export type StaffDetail = z.infer<typeof staffDetailSchema>;
export type CreateStaffRequest = z.infer<typeof createStaffSchema>;
export type StaffCreated = z.infer<typeof staffCreatedSchema>;
export type StaffDuty = z.infer<typeof staffDutySchema>;
export type StaffStatusChange = z.infer<typeof staffStatusChangeSchema>;
