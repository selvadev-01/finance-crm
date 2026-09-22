import { z } from "zod";

import { route } from "./route.js";
import {
  errorSchema,
  idSchema,
  nameSchema,
  calendarDateSchema,
  moneyStringSchema,
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

export const customerStatusSchema = z.enum([
  "ACTIVE",
  "INACTIVE",
  "BLACKLISTED",
]);

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

/**
 * One stay on a line (US-023). `effectiveTo` is null for the current line;
 * past collections keep the line they were taken under (BR-15).
 */
export const customerLinePeriodSchema = z.object({
  id: idSchema,
  lineId: idSchema,
  lineName: z.string(),
  lineCode: z.string(),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
  reason: z.string().nullable(),
});

/**
 * Customer 360's figures (US-022). Outstanding is **summed across the
 * customer's active accounts at read time**, never stored on the customer
 * (M04): a customer may hold several accounts (BR-01a), and a stored total
 * would be a cache of a sum of caches.
 */
export const customerOverviewSchema = z.object({
  accounts: z.object({
    active: z.number().int(),
    completed: z.number().int(),
    /** Pending, defaulted or written off — open but not collecting. */
    other: z.number().int(),
  }),
  /** The sum across active accounts, labelled as such wherever it is shown. */
  outstandingTotal: moneyStringSchema,
  /** Collected across every account the customer has ever held. */
  collectedTotal: moneyStringSchema,
  /** Active accounts past their target date with money still owed. */
  overdueAccounts: z.number().int().min(0),
  /** Slots marked MISSED on the active accounts — days nobody visited (BR-09). */
  missedDays: z.number().int().min(0),
  /** The last business date money was collected, on any account; null if never. */
  lastPaidOn: calendarDateSchema.nullable(),
  /**
   * Summed across every account. `null` for a Junior, who never sees invested
   * amount or profit (RBAC matrix, money visibility). Profit is P = A − I per
   * account (BR-01), what the accounts earn in full — not what is earned so far.
   */
  investedTotal: moneyStringSchema.nullable(),
  profitTotal: moneyStringSchema.nullable(),
  /** Who works this customer's line today (M03). */
  staff: z.object({
    seniorName: z.string().nullable(),
    juniorNames: z.array(z.string()),
  }),
});

const customerParams = z.object({ customerId: idSchema });

/**
 * J-09 — a line's customer portfolio, in visiting order (US-040): what each
 * customer owes and how their accounts stand, with the line's totals. For
 * every role in the line's scope, so it carries **no invested amount or
 * profit** — the one shape a Junior may see.
 */
export const linePortfolioSchema = z.object({
  businessDate: calendarDateSchema,
  totals: z.object({
    /** Across the line's active accounts. */
    outstandingTotal: moneyStringSchema,
    activeAccounts: z.number().int().min(0),
    overdueCustomers: z.number().int().min(0),
    /** Collected on the line's customers in the seven days ending today. */
    collectedLastSevenDays: moneyStringSchema,
  }),
  customers: z.array(
    z.object({
      customerId: idSchema,
      customerCode: z.string(),
      name: z.string(),
      address: z.string(),
      mobile: z.string(),
      /** Place on the visiting order; null until placed. */
      position: z.number().int().min(1).nullable(),
      outstandingTotal: moneyStringSchema,
      activeAccounts: z.number().int().min(0),
      completedAccounts: z.number().int().min(0),
      overdue: z.boolean(),
      /** MISSED slots on the active accounts (BR-09). */
      missedDays: z.number().int().min(0),
      /** A slot is due today on an active account. */
      dueToday: z.boolean(),
      /** A collection of more than nothing was recorded today. */
      paidToday: z.boolean(),
    }),
  ),
});

export const customerContract = {
  listCustomers: route({
    method: "GET",
    path: "/api/customers",
    summary:
      "Customers visible to the caller, optionally searched (S-08, US-024)",
    query: pageQuerySchema.extend({
      /**
       * US-024: a name (any part, any case), a customer code (`CUS-00417` or
       * just `417`), or a mobile as typed anywhere else. Matches any of them.
       */
      q: z
        .string()
        .trim()
        .max(80)
        .optional()
        .transform((value) => (value ? value : undefined)),
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

  updateCustomer: route({
    method: "PATCH",
    path: "/api/customers/:customerId",
    summary: "Edit a customer's details, status and references (US-021)",
    pathParams: customerParams,
    /**
     * The whole editable record, as the form holds it. The line is not here:
     * moving a customer is a transfer (US-023), with its own rules (BR-15).
     */
    body: z.object({
      name: nameSchema,
      mobile: mobileSchema,
      /** Omitted clears it. */
      alternateMobile: mobileSchema.optional(),
      address: z.string().trim().min(1).max(300),
      notes: optionalText(1000),
      /** A contact-quality flag; it never stops collection (M04). */
      status: customerStatusSchema,
      /**
       * The references to keep: one with an `id` is updated, one without is
       * added, and any not listed is removed. At least one remains (§7).
       */
      references: z
        .array(referenceInputSchema.extend({ id: idSchema.optional() }))
        .min(1, "at least one reference person is required")
        .max(5),
      /** As at onboarding, checked only when the mobile changes. */
      confirmDuplicateMobile: z.boolean().default(false),
    }),
    responses: {
      200: customerDetailSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
      422: errorSchema,
    },
  }),
  transferCustomer: route({
    method: "POST",
    path: "/api/customers/:customerId/line-transfer",
    summary: "Move a customer to another line from today (US-023)",
    pathParams: customerParams,
    body: z.object({
      lineId: idSchema,
      /** Why they moved — shown in the transfer history. */
      reason: optionalText(200),
    }),
    responses: {
      200: customerDetailSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
    },
  }),

  getCustomerOverview: route({
    method: "GET",
    path: "/api/customers/:customerId/overview",
    summary: "Customer 360's totals and assigned staff (US-022, S-09)",
    pathParams: customerParams,
    responses: {
      200: customerOverviewSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
    },
  }),

  getLinePortfolio: route({
    method: "GET",
    path: "/api/lines/:lineId/customer-portfolio",
    summary: "A line's customers in visiting order, with what each owes (J-09)",
    pathParams: z.object({ lineId: idSchema }),
    responses: {
      200: linePortfolioSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
    },
  }),

  listCustomerTransfers: route({
    method: "GET",
    path: "/api/customers/:customerId/line-transfers",
    summary: "Which line this customer was on, and when (US-023)",
    pathParams: customerParams,
    responses: {
      200: z.object({ data: z.array(customerLinePeriodSchema) }),
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
    },
  }),
} as const;

export type CustomerOverview = z.infer<typeof customerOverviewSchema>;
export type LinePortfolio = z.infer<typeof linePortfolioSchema>;
export type CustomerSummary = z.infer<typeof customerSummarySchema>;
export type CustomerLinePeriod = z.infer<typeof customerLinePeriodSchema>;
export type CustomerDetail = z.infer<typeof customerDetailSchema>;
export type CustomerReference = z.infer<typeof customerReferenceSchema>;
