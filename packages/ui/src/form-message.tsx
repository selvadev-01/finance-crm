import { Info, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * A message about the whole form, not one field — "This account cannot sign
 * in", "Could not reach Rasi". Field-level problems belong in `Field`.
 *
 * `critical` is announced immediately (`role="alert"`); `info` politely
 * (`role="status"`). Status colours are for status, so this is the only place
 * on a form that uses them.
 */
const message = cva(
  "flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm",
  {
    variants: {
      tone: {
        critical: "border-critical/30 bg-critical-subtle text-ink",
        info: "border-info/30 bg-info-subtle text-ink",
      },
    },
    defaultVariants: { tone: "critical" },
  },
);

export type FormMessageProps = VariantProps<typeof message> & {
  children: ReactNode;
  className?: string;
};

export function FormMessage({ tone, children, className }: FormMessageProps) {
  const Icon = tone === "info" ? Info : WarningCircle;
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(message({ tone }), className)}
    >
      <Icon
        aria-hidden
        size={18}
        weight="regular"
        className={cn(
          "mt-px shrink-0",
          tone === "info" ? "text-info" : "text-critical",
        )}
      />
      <div>{children}</div>
    </div>
  );
}
