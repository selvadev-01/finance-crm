import { z } from "zod";

import { route } from "./route.js";
import { errorSchema, idSchema } from "./shared.js";

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

export const staffContract = {
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
