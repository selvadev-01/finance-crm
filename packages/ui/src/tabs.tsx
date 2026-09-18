"use client";

import { Tabs as RadixTabs } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn";

/**
 * Tabs for the parts of one record — a customer's profile, accounts and
 * history (S-09). Not for navigation between pages: those are links.
 *
 * Controlled by the screen (`value` / `onValueChange`) so the chosen tab can
 * live in the URL (`?tab=`) and survive a reload or a shared link.
 */
function Root({ className, ...props }: ComponentProps<typeof RadixTabs.Root>) {
  return (
    <RadixTabs.Root
      className={cn("flex flex-col gap-[var(--stack-gap)]", className)}
      {...props}
    />
  );
}

function List({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      // The rule is an inset shadow rather than a border so the active tab's
      // underline can sit on it without overflowing the scroll box.
      className={cn(
        "flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

function Trigger({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "inline-flex h-[var(--control-height)] shrink-0 items-center gap-2 border-b-2 border-transparent px-3",
        "text-label whitespace-nowrap text-ink-muted transition-colors hover:text-ink",
        "data-[state=active]:border-accent data-[state=active]:text-ink",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Content({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cn(
        "flex flex-col gap-[var(--section-gap)] focus-visible:outline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

export const Tabs = { Root, List, Trigger, Content };
