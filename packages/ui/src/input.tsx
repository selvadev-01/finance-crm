import type { ComponentProps } from "react";

import { cn } from "./cn";
import { controlFrame } from "./control";

/**
 * A text input on the control scale: height and padding come from the density
 * variables, so it is a 44px touch target in the field app and 36px in the
 * console, like `Button`.
 *
 * Invalid state is `aria-invalid`, not a prop — `Field` and `FormField` set it.
 */
export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        controlFrame,
        "h-[var(--control-height)] px-[var(--control-padding-x)]",
        "[&::-webkit-inner-spin-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );
}
