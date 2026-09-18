import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { formatPerMille } from "../../../lib/money";

/** Shared by the dashboards: S-07 (US-080), S-20 (US-082) and S-19 (US-083). */

/** Opens the sector comparison (US-081) for the date shown. */
export function CompareSectorsLink({ date }: { date: string }) {
  return (
    <Link
      href={`/dashboard/sectors?date=${date}`}
      className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
    >
      Compare sectors
      <ArrowRight aria-hidden size={14} />
    </Link>
  );
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** S-07's rule, on every dashboard: an unknown is a dash, never a zero. */
export const UNAVAILABLE = "Couldn’t be worked out just now";

export function Unknown() {
  return (
    <span className="text-ink-subtle">
      —<span className="sr-only"> (unavailable)</span>
    </span>
  );
}

/**
 * Collected against expected as a bar. The share is computed in exact paise;
 * past 100% the bar stays full and the figure beside it says how far.
 */
export function Meter({ share, label }: { share: number; label: string }) {
  const filled = Math.min(share, 1000);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={filled / 10}
      aria-valuetext={formatPerMille(share)}
      className="block h-1.5 w-full min-w-16 overflow-hidden rounded-pill bg-surface-sunken"
    >
      <span
        className="block h-full rounded-pill bg-accent"
        style={{ width: `${filled / 10}%` }}
      />
    </span>
  );
}
