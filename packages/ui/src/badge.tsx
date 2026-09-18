import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * Status badge.
 *
 * `tone` maps to meaning, never to a colour name: a caller writing
 * `tone="critical"` keeps working if critical stops being red, whereas
 * `tone="red"` would have to be found and changed everywhere.
 *
 * Text is the tone's strong colour on its `-subtle` ground — held to 4.5:1 by
 * `theme.test.ts`, so no caller needs to darken it. A coloured dot carries the
 * tone for anyone scanning a column; `neutral` has none, because "nothing to
 * report" should not draw the eye.
 *
 * The Junior's three-state sync indicator (Saved on device / Syncing /
 * Synced) and collection classification (CORRECT / LOW / EXTRA / NO_PAYMENT)
 * both render through this.
 */
const badge = cva(
  [
    "inline-flex w-fit items-center gap-1.5 rounded-control border",
    "px-1.5 py-px text-2xs font-medium whitespace-nowrap",
  ],
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-sunken text-ink-muted",
        positive: "border-positive-border bg-positive-subtle text-positive",
        warning: "border-warning-border bg-warning-subtle text-warning",
        critical: "border-critical-border bg-critical-subtle text-critical",
        info: "border-info-border bg-info-subtle text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const dot = {
  neutral: null,
  positive: "bg-positive-bright",
  warning: "bg-warning-bright",
  critical: "bg-critical-bright",
  info: "bg-info-bright",
} as const;

export type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badge> & {
    /**
     * `dot` (default) draws the tone's dot; `none` when the badge brings its
     * own mark — the Junior's sync spinner, a tick.
     */
    mark?: "dot" | "none";
  };

export function Badge({
  tone,
  mark = "dot",
  className,
  children,
  ...props
}: BadgeProps) {
  const dotClass = mark === "dot" ? dot[tone ?? "neutral"] : null;
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {dotClass ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-pill", dotClass)}
        />
      ) : null}
      {children}
    </span>
  );
}
