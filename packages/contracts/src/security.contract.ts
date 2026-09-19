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
 * M13 Security log — the attempts the API **refused** (ADR-0014).
 *
 * The audit log answers "who changed what"; this answers "who tried to do
 * something they were not allowed to, and was turned away". It is read by the
 * same roles for the same reason (`audit.view`, Admin and Super Admin): it
 * records everyone's attempts, and showing it to Seniors and Juniors would
 * reveal other staff members' activity.
 */

/** Why the attempt was refused. Mirrors the `SecurityEventKind` enum. */
export const securityEventKindSchema = z.enum([
  "PERMISSION_DENIED",
  "RANK_GUARD",
  "SELF_GUARD",
  "SETTING_LOCKED",
  "OUT_OF_SCOPE",
]);

export const securityEventSchema = z.object({
  id: idSchema,
  createdAt: z.string(),
  kind: securityEventKindSchema,
  /** The stable `AppError` code the caller was answered with. */
  code: z.string(),
  status: z.number().int(),
  method: z.string(),
  /** The route pattern, e.g. `/api/staff/:staffProfileId/role`. */
  path: z.string(),
  /** Who attempted it. Always a signed-in staff member. */
  actor: z.object({
    userId: z.string(),
    name: z.string(),
    role: z.enum(["SUPER_ADMIN", "ADMIN", "SENIOR", "JUNIOR"]),
  }),
  targetTable: z.string().nullable(),
  targetId: z.string().nullable(),
  /** Curated facts about the attempt — never a request body. */
  detail: z.record(z.string(), z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const securityContract = {
  listSecurityEvents: route({
    method: "GET",
    path: "/api/security-events",
    summary:
      "Refused security-relevant attempts, newest first, filtered by staff member, kind, code and date (ADR-0014)",
    query: pageQuerySchema.extend({
      actorUserId: z.string().min(1).max(64).optional(),
      kind: securityEventKindSchema.optional(),
      code: z.string().min(1).max(64).optional(),
      /** Business dates, inclusive, in the business time zone. */
      from: calendarDateSchema.optional(),
      to: calendarDateSchema.optional(),
    }),
    responses: {
      200: pageSchema(securityEventSchema),
      ...errors,
    },
  }),
} as const;

export type SecurityEvent = z.infer<typeof securityEventSchema>;
export type SecurityEventKind = z.infer<typeof securityEventKindSchema>;
