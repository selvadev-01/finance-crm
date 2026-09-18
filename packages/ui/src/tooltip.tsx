"use client";

import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { cn } from "./cn";
import { usePortalContainer } from "./portal-container";

export interface TooltipProps {
  content: ReactNode;
  /** One focusable element: the tooltip is its description on hover and focus. */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  /** For the floating label — e.g. hide it where the text is already shown. */
  className?: string;
}

/**
 * A short label for something that shows only an icon — the collapsed
 * sidebar. Never the only place information lives: a touch screen has no
 * hover, so the element still needs its own accessible name.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  const container = usePortalContainer();
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal container={container}>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-50 rounded-sm bg-ink px-2 py-1 text-caption text-ink-inverse shadow-popover",
              "data-[state=delayed-open]:animate-in",
              className,
            )}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
