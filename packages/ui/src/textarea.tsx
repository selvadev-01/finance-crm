import type { ComponentProps } from "react";

import { cn } from "./cn";
import { controlFrame } from "./control";

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
        controlFrame,
        "min-h-[calc(var(--control-height)*2)] resize-y px-[var(--control-padding-x)] py-2",
        className,
      )}
      {...props}
    />
  );
}
