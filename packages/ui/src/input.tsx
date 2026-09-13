import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * A text input on the control scale: height and padding come from the density
 * variables, so it is a 44px touch target in the field app and 36px in the
 * console, like `Button`.
 *
 * Invalid state is `aria-invalid`, not a prop — the same attribute a screen
 * reader announces is the one that draws the critical outline, so the two can
 * never disagree. `Field` sets it.
 */
export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "block w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface-raised",
        "h-[var(--control-height)] px-[var(--control-padding-x)] text-[length:var(--control-font-size)] text-ink",
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
