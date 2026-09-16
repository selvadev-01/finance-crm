import { z } from "zod";

import { mobileSchema } from "./customer.contract.js";
import { route } from "./route.js";
import { errorSchema, idSchema, nameSchema } from "./shared.js";

/**
 * M01 Identity — organization sign-up (US-006, ADR-0012).
 *
 * Public: creates a business and its owner, the first Super Admin, in one
 * step. The organization's slug is generated from its name by the server and
 * never sent. Every other staff member is still created by an Admin (US-092).
 */
export const signUpRequestSchema = z.object({
  organizationName: nameSchema,
  name: nameSchema,
  /** Stored lower-case, as Better Auth compares it at sign-in. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("must be an email address").max(254)),
  phone: mobileSchema,
  /** Better Auth's limits (auth.config.ts): at least 10 characters. */
  password: z
    .string()
    .min(10, "must be at least 10 characters")
    .max(128, "must be at most 128 characters"),
});

/** Lowercase letters and digits in hyphen-separated groups, 3–63 characters. */
export const organizationSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "is not an organization link");

export const signUpResultSchema = z.object({
  organizationId: idSchema,
  staffProfileId: idSchema,
  /** The organization's sign-in link is `/<slug>/sign-in`. */
  slug: z.string(),
});

/** What anyone may learn from a sign-in link: the business name. */
export const organizationPublicSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const signUpContract = {
  signUpOrganization: route({
    method: "POST",
    path: "/api/organizations",
    summary:
      "Create an organization and its owner as Super Admin (US-006)",
    body: signUpRequestSchema,
    responses: {
      201: signUpResultSchema,
      400: errorSchema,
      409: errorSchema,
      429: errorSchema,
    },
  }),

  getOrganizationBySlug: route({
    method: "GET",
    path: "/api/organizations/:slug",
    summary: "The business name behind a sign-in link (US-006)",
    pathParams: z.object({ slug: organizationSlugSchema }),
    responses: {
      200: organizationPublicSchema,
      400: errorSchema,
      404: errorSchema,
    },
  }),
} as const;

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
export type SignUpResult = z.infer<typeof signUpResultSchema>;
export type OrganizationPublic = z.infer<typeof organizationPublicSchema>;
