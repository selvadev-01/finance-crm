"use client";

import { Popover as RadixPopover } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { usePortalContainer } from "./portal-container";

/** The floating surface shared by popovers, menus and the combobox list. */
export const floatingSurface =
  "z-50 rounded-control border border-border bg-surface-overlay text-ink shadow-popover data-[state=open]:animate-in";

function Content({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  const container = usePortalContainer();
  return (
    <RadixPopover.Portal container={container}>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(floatingSurface, "p-3 outline-none", className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
}

/**
 * A non-modal floating panel anchored to its trigger. Mounts inside the
 * nearest `Dialog` when there is one (portal-container.tsx).
 */
export const Popover = {
  Root: RadixPopover.Root,
  Trigger: RadixPopover.Trigger,
  Anchor: RadixPopover.Anchor,
  Close: RadixPopover.Close,
  Content,
};
