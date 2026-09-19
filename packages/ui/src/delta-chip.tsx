import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
} from "@phosphor-icons/react/dist/ssr";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn";

const chip = cva(
  "inline-flex w-fit items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        positive: "bg-positive-subtle text-positive",
        critical: "bg-critical-subtle text-critical",
        neutral: "bg-surface-sunken text-ink-muted",
      },
    },
  },
);

const ARROW = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const;

interface DeltaChipProps {
  /** Which way the figure moved. */
  direction: "up" | "down" | "flat";
  /**
   * Whether that movement is good news. Separate from `direction`: more
   * collected is good, a larger shortfall is not.
   */
  tone: "positive" | "critical" | "neutral";
  /** The change, formatted: "+₹1,200.00". */
  children: ReactNode;
  /** What it is compared with, read after the figure: "vs Friday". */
  comparedWith?: string;
  className?: string;
}

/** A change since the working day before, beside a KPI tile's figure. */
export function DeltaChip({
  direction,
  tone,
  children,
  comparedWith,
  className,
}: DeltaChipProps) {
  const Arrow = ARROW[direction];
  return (
    <span className={cn(chip({ tone }), className)}>
      <Arrow aria-hidden size={12} weight="bold" />
      <span data-numeric>{children}</span>
      {comparedWith ? (
        <span className="font-normal opacity-80">{comparedWith}</span>
      ) : null}
    </span>
  );
}
