import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import type { CalendarDate } from "./calendar-date.js";

/**
 * The business runs in India. Fixed in code, not configurable (ADR-0009): a
 * wrong setting would silently misfile every collection in the system.
 */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const inBusinessTimeZone = tz(BUSINESS_TIME_ZONE);

/**
 * `DATE(instant AT TIME ZONE 'Asia/Kolkata')` — BR-12, ADR-0009.
 *
 * **The only place in the system where an instant becomes a calendar date.**
 * Compute it once, when `capturedAt` is recorded, and store the result; never
 * convert at query time.
 *
 * A collection at 05:10 IST is 23:40 UTC the previous day. Taking the UTC date,
 * or the server's local date, files that morning's collection under yesterday.
 *
 * India observes no DST, but a real timezone database is used rather than a
 * fixed +05:30 so that is not a latent assumption (M06 risks).
 */
export function toBusinessDate(instant: Date): CalendarDate {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("toBusinessDate: Invalid Date");
  }
  return format(instant, "yyyy-MM-dd", {
    in: inBusinessTimeZone,
  }) as CalendarDate;
}
