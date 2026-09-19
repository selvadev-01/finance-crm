import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { arrowLinkClass, RadialMeter, Meter as UiMeter } from "@repo/ui";
import Link from "next/link";

import { formatTimestamp } from "../../../lib/format";
import { formatPerMille } from "../../../lib/money";

/** Shared by the dashboards: S-07 (US-080), S-20 (US-082) and S-19 (US-083). */

/** Opens the sector comparison (US-081) for the date shown. */
export function CompareSectorsLink({ date }: { date: string }) {
  return (
    <Link href={`/dashboard/sectors?date=${date}`} className={arrowLinkClass}>
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

type MeterTone = "accent" | "positive" | "warning" | "critical";

/**
 * Collected against expected as a bar. The share is computed in exact paise;
 * past 100% the bar stays full and the figure beside it says how far.
 */
export function Meter({
  share,
  label,
  tone,
}: {
  share: number;
  label: string;
  tone?: MeterTone;
}) {
  return (
    <UiMeter
      value={share}
      label={label}
      valueText={formatPerMille(share)}
      tone={tone}
    />
  );
}

/**
 * A headline share in the hero (ADR-0015). `share` null — nothing was due,
 * or the figure is unknown — shows no ring rather than an empty one.
 */
export function ShareRing({
  share,
  label,
  caption,
  tone,
}: {
  share: number | null;
  label: string;
  caption: string;
  tone?: MeterTone;
}) {
  if (share === null) return null;
  return (
    <RadialMeter
      value={share}
      label={label}
      caption={caption}
      valueText={formatPerMille(share)}
      tone={tone}
    />
  );
}

/** A count as a share of a whole, in tenths of a percent; null when the whole is 0. */
export function countShare(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.floor((part * 1000) / whole);
}

/** The hero's "Live · updated 14:30", beside the date. */
export function LiveStamp({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2 animate-pulse rounded-pill bg-positive-bright motion-reduce:animate-none"
      />
      Live · updated {formatTimestamp(at, "clock")}
    </span>
  );
}
