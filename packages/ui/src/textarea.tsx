import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * Multi-line text on the same frame as `Input` — addresses and notes. Padding
 * and text size come from the density variables; the minimum height is two
 * control heights so an address is visibly more than one line.
 */
export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "block w-full min-w-0 resize-y rounded-[var(--radius-control)] border border-border-strong bg-surface-raised",
        "min-h-[calc(var(--control-height)*2)] px-[var(--control-padding-x)] py-2 text-[length:var(--control-font-size)] text-ink",
        "placeholder:text-ink-subtle",
        "transition-colors hover:border-ink-subtle",
        "aria-invalid:border-critical",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}
