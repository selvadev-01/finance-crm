import { CaretUpDown } from "@phosphor-icons/react/dist/ssr";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { controlFrame } from "./control";

/**
 * A native select on the control scale, styled to match `Input`.
 *
 * Native on purpose: it brings the platform's own picker on a phone, keyboard
 * type-ahead on desktop, and correct semantics without a line of ARIA. Reach
 * for `Combobox` only when the list is long enough to need typing. Invalid
 * state is `aria-invalid`, which `Field` sets.
 *
 * `className` goes on the wrapper, which is what a layout wants to size.
 */
export type SelectProps = ComponentProps<"select">;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          controlFrame,
          "h-[var(--control-height)] appearance-none pr-9 pl-[var(--control-padding-x)]",
        )}
        {...props}
      >
        {children}
      </select>
      <CaretUpDown
        aria-hidden
        size={14}
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
}
