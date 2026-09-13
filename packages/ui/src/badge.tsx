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
 * The Junior's three-state sync indicator (Saved on device / Syncing /
 * Synced) and collection classification (CORRECT / LOW / EXTRA / NO_PAYMENT)
 * both render through this.
 */
const badge = cva(
  [
    "inline-flex items-center gap-1.5 rounded-full",
    "px-2.5 py-0.5 text-2xs font-medium",
  ],
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-ink-muted",
        positive: "bg-positive-subtle text-positive",
        warning: "bg-warning-subtle text-warning",
        critical: "bg-critical-subtle text-critical",
        info: "bg-info-subtle text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badge>;

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
