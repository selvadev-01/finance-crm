import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * A native select on the control scale, styled to match `Input`.
 *
 * Native on purpose: it brings the platform's own picker on a phone, keyboard
 * type-ahead on desktop, and correct semantics without a line of ARIA. Invalid
 * state is `aria-invalid`, which `Field` sets.
 */
export type SelectProps = ComponentProps<"select">;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "block w-full min-w-0 appearance-none rounded-[var(--radius-control)] border border-border-strong bg-surface-raised",
          "h-[var(--control-height)] pl-[var(--control-padding-x)] pr-9 text-[length:var(--control-font-size)] text-ink",
          "transition-colors hover:border-ink-subtle",
          "aria-invalid:border-critical",
          "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted",
        )}
        {...props}
      >
        {children}
      </select>
      <CaretDown
        aria-hidden
        size={16}
        weight="regular"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}
