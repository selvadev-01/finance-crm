import { Info, Warning, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * A message about the whole form, not one field — "This account cannot sign
 * in", "Could not reach Rasi". Field-level problems belong in `Field`.
 *
 * `critical` is announced immediately (`role="alert"`); `warning` and `info`
 * politely (`role="status"`). `warning` is for something that does not block
 * — a mobile number already on another customer — and usually carries its own
 * action. Status colours are for status, so this is the only place on a form
 * that uses them.
 */
const message = cva(
  "flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-body text-ink",
  {
    variants: {
      tone: {
        critical: "border-critical-border bg-critical-subtle",
        warning: "border-warning-border bg-warning-subtle",
        info: "border-info-border bg-info-subtle",
      },
    },
    defaultVariants: { tone: "critical" },
  },
);

const icon = {
  critical: { Icon: WarningCircle, className: "text-critical" },
  warning: { Icon: Warning, className: "text-warning" },
  info: { Icon: Info, className: "text-info" },
} as const;

export type FormMessageProps = VariantProps<typeof message> & {
  children: ReactNode;
  /** Something to do about it — "Save anyway", "Try again". */
  action?: ReactNode;
  className?: string;
};

export function FormMessage({
  tone,
  children,
  action,
  className,
}: FormMessageProps) {
  const resolved = tone ?? "critical";
  const { Icon, className: iconClass } = icon[resolved];
  return (
    <div
      role={resolved === "critical" ? "alert" : "status"}
      className={cn(message({ tone }), className)}
    >
      <Icon
        aria-hidden
        size={18}
        weight="regular"
        className={cn("mt-px shrink-0", iconClass)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>{children}</div>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
