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

/**
 * The strip the tabs sit on. The rule is an inset shadow rather than a border
 * so the active tab's underline can sit on it without overflowing the scroll
 * box.
 *
 * Exported because a set of pages switched between by link — the Settings
 * group — must look like one control while staying real navigation. Those are
 * `<a>`s in a `<nav>`, not `Tabs`, and mark the current one with
 * `aria-current="page"` (`tabLinkClass` reads it).
 */
export const tabListClass =
  "flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]";

/**
 * One tab. Active is `data-[state=active]` for `Tabs.Trigger` and
 * `aria-current="page"` for a link, so both wear the same underline.
 */
export const tabLinkClass = cn(
  "inline-flex h-[var(--control-height)] shrink-0 items-center gap-2 border-b-2 border-transparent px-3",
  "text-label whitespace-nowrap text-ink-muted transition-colors hover:text-ink",
  "data-[state=active]:border-accent data-[state=active]:text-ink",
  "aria-[current=page]:border-accent aria-[current=page]:text-ink",
  "disabled:pointer-events-none disabled:opacity-50",
);

function List({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn(tabListClass, className)} {...props} />;
}

function Trigger({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger className={cn(tabLinkClass, className)} {...props} />
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
