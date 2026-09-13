import { z } from "zod";

import { route } from "./route.js";
import {
  errorSchema,
  idSchema,
  nameSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M04 Customers — onboarding and the customer record (US-020).
 */

/**
 * An Indian mobile number, accepted as typed — `98765 43210`, `098765-43210`,
 * `+91 98765 43210` — and carried as E.164, `+919876543210` (data dictionary).
 * Business is India-only (INR, Asia/Kolkata), so a bare 10-digit number is
 * unambiguous.
 */
export const mobileSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .transform((value) => {
    if (/^\+91\d{10}$/.test(value)) return value;
    if (/^0\d{10}$/.test(value)) return `+91${value.slice(1)}`;
    if (/^91\d{10}$/.test(value)) return `+${value}`;
    if (/^\d{10}$/.test(value)) return `+91${value}`;
    return value;
  })
  .pipe(
    z
      .string()
      .regex(/^\+91[6-9]\d{9}$/, "must be a 10-digit Indian mobile number"),
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const referenceInputSchema = z.object({
  name: nameSchema,
  mobile: mobileSchema,
  /** Free text — "brother", "shop owner opposite". */
  relation: optionalText(80),
  address: optionalText(300),
});

export const customerStatusSchema = z.enum(["ACTIVE", "INACTIVE", "BLACKLISTED"]);

export const customerReferenceSchema = z.object({
  id: idSchema,
  name: z.string(),
  mobile: z.string(),
  relation: z.string().nullable(),
  address: z.string().nullable(),
});

export const customerSummarySchema = z.object({
  id: idSchema,
  customerCode: z.string(),
  name: z.string(),
  mobile: z.string(),
  status: customerStatusSchema,
  lineId: idSchema,
  lineName: z.string(),
  sectorId: idSchema,
});

export const customerDetailSchema = customerSummarySchema.extend({
  alternateMobile: z.string().nullable(),
  address: z.string(),
  notes: z.string().nullable(),
  sectorName: z.string(),
  references: z.array(customerReferenceSchema),
});

const customerParams = z.object({ customerId: idSchema });

export const customerContract = {
  listCustomers: route({
    method: "GET",
    path: "/api/customers",
    summary: "Customers visible to the caller (S-08)",
    query: pageQuerySchema.extend({
      lineId: idSchema.optional(),
      /** Exact match after normalising — the duplicate-mobile lookup. */
      mobile: mobileSchema.optional(),
      status: customerStatusSchema.optional(),
    }),
    responses: {
      200: pageSchema(customerSummarySchema),
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),

  getCustomer: route({
    method: "GET",
    path: "/api/customers/:customerId",
    summary: "One customer with references (S-09, first part)",
    pathParams: customerParams,
    responses: {
      200: customerDetailSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
    },
  }),

  createCustomer: route({
    method: "POST",
    path: "/api/customers",
    summary: "Onboard a customer with at least one reference (US-020)",
    body: z.object({
      name: nameSchema,
      mobile: mobileSchema,
      alternateMobile: mobileSchema.optional(),
      address: z.string().trim().min(1).max(300),
      /** The sector is taken from the line, never sent (M04). */
      lineId: idSchema,
      notes: optionalText(1000),
      references: z
        .array(referenceInputSchema)
        .min(1, "at least one reference person is required")
        .max(5),
      /**
       * US-020: a mobile already on another customer is allowed but warned.
       * Without this the API answers `409 DUPLICATE_MOBILE`; the form shows
       * the existing customers and resubmits with it set.
       */
      confirmDuplicateMobile: z.boolean().default(false),
    }),
    responses: {
      201: customerDetailSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
      422: errorSchema,
    },
  }),
} as const;

export type CustomerSummary = z.infer<typeof customerSummarySchema>;
export type CustomerDetail = z.infer<typeof customerDetailSchema>;
export type CustomerReference = z.infer<typeof customerReferenceSchema>;
