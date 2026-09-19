import { z } from "zod";

import { collectionContract } from "./collection.contract.js";
import { dashboardContract } from "./dashboard.contract.js";
import { reportContract } from "./report.contract.js";
import { route } from "./route.js";
import { errorSchema } from "./shared.js";

/**
 * M12 export — the reports, the dashboards and the collection list (S-16) as
 * an Excel workbook or a PDF, built on the server from the **same service
 * call** the screen reads, so a file can never disagree with the page.
 *
 * - **The screen's permission and scope.** Each export is guarded by the
 *   permission of the view it exports, and a sector, line or staff member out
 *   of scope is `404` exactly as it is there. No RBAC cell changes.
 * - **The whole set, not the page.** A paged view (overdue, discrepancy,
 *   collections) is read to its end; more than {@link EXPORT_ROW_LIMIT} rows
 *   is `422 EXPORT_TOO_LARGE` rather than a silently cut file.
 * - **Recorded.** Every export writes an `EXPORT` audit entry naming the
 *   export, the format, the filters and the row count (M13).
 * - **A figure that could not be read is blank with a note, never `0`** (S-07).
 */

export const exportFormatSchema = z.enum(["xlsx", "pdf"]);

/** Rows one export may carry: past it, narrow the filters. */
export const EXPORT_ROW_LIMIT = 10_000;

/**
 * The success "body" of a file route: bytes, never parsed. Present only
 * because every route declares exactly one 2xx schema.
 */
export const fileBodySchema = z.unknown();

const format = { format: exportFormatSchema };

/** Errors every export can answer with, beside the view's own. */
const exportErrors = {
  /** A malformed filter, date or format. */
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  /** A sector, line or staff member that does not exist or is out of scope. */
  404: errorSchema,
  /** A date after today, or more rows than {@link EXPORT_ROW_LIMIT}. */
  422: errorSchema,
};

/** The view's own filters, without its cursor: an export is the whole set. */
const unpaged = { cursor: true, limit: true } as const;

export const exportContract = {
  lineWiseReport: route({
    method: "GET",
    path: "/api/exports/reports/line-wise",
    summary: "The line-wise report (US-084) as Excel or PDF",
    query: reportContract.getLineWise.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  investmentReport: route({
    method: "GET",
    path: "/api/exports/reports/investment",
    summary: "The investment overview (US-085) as Excel or PDF",
    query: reportContract.getInvestment.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  collectionReport: route({
    method: "GET",
    path: "/api/exports/reports/collection",
    summary: "The collection report (US-086) as Excel or PDF",
    query: reportContract.getCollection.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  overdueReport: route({
    method: "GET",
    path: "/api/exports/reports/overdue",
    summary:
      "The overdue report (US-087) as Excel or PDF — every matching account, not one page",
    query: reportContract.getOverdue.query.omit(unpaged).extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  discrepancyReport: route({
    method: "GET",
    path: "/api/exports/reports/discrepancy",
    summary:
      "The discrepancy report (BR-17) as Excel or PDF — every matching row, not one page",
    query: reportContract.getDiscrepancy.query.omit(unpaged).extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  collections: route({
    method: "GET",
    path: "/api/exports/collections",
    summary:
      "The collection list (S-16) as Excel or PDF — every matching entry, not one page",
    query: collectionContract.listCollections.query
      .omit(unpaged)
      .extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  overviewDashboard: route({
    method: "GET",
    path: "/api/exports/dashboards/overview",
    summary: "The business overview (US-080, S-07) as Excel or PDF",
    query: dashboardContract.getOverview.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  operationsDashboard: route({
    method: "GET",
    path: "/api/exports/dashboards/operations",
    summary: "The Admin operational dashboard (US-082, S-20) as Excel or PDF",
    query: dashboardContract.getOperations.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  sectorsDashboard: route({
    method: "GET",
    path: "/api/exports/dashboards/sectors",
    summary: "The sector comparison (US-081) as Excel or PDF",
    query: dashboardContract.getSectors.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
  lineDashboard: route({
    method: "GET",
    path: "/api/exports/dashboards/line",
    summary: "One line's day (US-083, S-19) as Excel or PDF",
    query: dashboardContract.getLine.query.extend(format),
    file: true,
    responses: { 200: fileBodySchema, ...exportErrors },
  }),
} as const;

export type ExportFormat = z.infer<typeof exportFormatSchema>;
