import { BUSINESS_TIME_ZONE } from "@repo/domain";

/**
 * Display formats that are not money or a business date — those are
 * `formatCurrency` and `formatBusinessDate` in `@repo/ui`.
 */

/** Display form of an E.164 Indian mobile: `+919876543210` → `+91 98765 43210`. */
export function formatMobile(mobile: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(mobile);
  return match ? `+91 ${match[1]} ${match[2]}` : mobile;
}

/**
 * Instants — an audit entry, a notification, a sync — are shown in the
 * business time zone, so a Senior in the office and the log agree on the
 * clock. This is display only: a *business date* is still decided once, by
 * `toBusinessDate` (BR-12).
 */
const FORMATS = {
  /** `16 Sept 2026, 2:05:09 pm` — the audit log. */
  full: new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "medium",
  }),
  /** `16 Sept, 2:05 pm` — notifications. */
  short: new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }),
  /** `2:05 pm` — today's sync marks. */
  clock: new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }),
} as const;

export function formatTimestamp(
  instant: string | Date,
  style: keyof typeof FORMATS = "full",
): string {
  return FORMATS[style].format(
    typeof instant === "string" ? new Date(instant) : instant,
  );
}
