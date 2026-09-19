import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * A share of a whole, drawn as a bar or a ring. `value` is **tenths of a
 * percent** (per-mille), worked out by the caller in exact paise — this only
 * draws it, and never sees an amount (coding-guidelines non-negotiable 1).
 * Past 1000 the mark stays full and `valueText` says how far.
 */
interface MeterProps {
  /** Per-mille: 883 is 88.3%. */
  value: number;
  /** What is measured: "Collected of expected". */
  label: string;
  /** The value as read aloud and shown: "88.3%". */
  valueText: string;
  tone?: MeterTone;
  className?: string;
}

type MeterTone = NonNullable<VariantProps<typeof meterFill>["tone"]>;

const meterFill = cva("block h-full rounded-pill", {
  variants: {
    tone: {
      accent: "bg-accent",
      positive: "bg-positive-bright",
      warning: "bg-warning-bright",
      critical: "bg-critical-bright",
    },
  },
  defaultVariants: { tone: "accent" },
});

const clampShare = (value: number) => Math.max(0, Math.min(value, 1000));

export function Meter({
  value,
  label,
  valueText,
  tone,
  className,
}: MeterProps) {
  const filled = clampShare(value);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={filled / 10}
      aria-valuetext={valueText}
      className={cn(
        "block h-1.5 w-full min-w-16 overflow-hidden rounded-pill bg-surface-sunken",
        className,
      )}
    >
      <span
        className={meterFill({ tone })}
        style={{ width: `${filled / 10}%` }}
      />
    </span>
  );
}

const ringStroke = {
  accent: "stroke-accent",
  positive: "stroke-positive-bright",
  warning: "stroke-warning-bright",
  critical: "stroke-critical-bright",
} as const;

interface RadialMeterProps extends MeterProps {
  /** The line under the ring: "Collected". Defaults to `label`. */
  caption?: ReactNode;
}

/**
 * A ring for a dashboard's headline shares (ADR-0015). The circle's
 * `pathLength` is 1000, so the per-mille value is the stroke's length as is —
 * no geometry, and nothing to round.
 */
export function RadialMeter({
  value,
  label,
  valueText,
  tone = "accent",
  caption,
  className,
}: RadialMeterProps) {
  const filled = clampShare(value);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={filled / 10}
        aria-valuetext={valueText}
        className="relative grid size-12 shrink-0 place-items-center"
      >
        <svg
          aria-hidden
          viewBox="0 0 48 48"
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            strokeWidth="5"
            className="stroke-surface-sunken"
          />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            strokeWidth="5"
            // A round cap on an empty arc would still draw a dot at 0%.
            strokeLinecap={filled === 0 ? "butt" : "round"}
            pathLength={1000}
            strokeDasharray={`${filled} 1000`}
            className={cn(
              ringStroke[tone],
              "transition-[stroke-dasharray] duration-500 motion-reduce:transition-none",
            )}
          />
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-heading text-ink" data-numeric>
          {valueText}
        </span>
        <span className="text-caption text-ink-muted">{caption ?? label}</span>
      </span>
    </div>
  );
}
