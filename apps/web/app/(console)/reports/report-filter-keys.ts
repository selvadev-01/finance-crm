/**
 * The URL filters each M12 report reads in its server `page.tsx`. They live
 * here, not beside the report components, because those are `"use client"`
 * modules: a server component importing a plain value from one gets a client
 * reference, not the array.
 */
export const REPORT_FILTER_KEYS = ["from", "to", "sector", "line"] as const;

export const COLLECTION_FILTER_KEYS = [
  ...REPORT_FILTER_KEYS,
  "junior",
  "classification",
] as const;

export const DISCREPANCY_FILTER_KEYS = [
  ...REPORT_FILTER_KEYS,
  "junior",
  "show",
] as const;

/** No date range: the overdue report is the position now, not a period. */
export const OVERDUE_FILTER_KEYS = [
  "sector",
  "line",
  "overdue",
  "sort",
] as const;
