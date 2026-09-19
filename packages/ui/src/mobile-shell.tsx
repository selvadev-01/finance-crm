"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "./cn";

/**
 * The console on a phone (ADR-0016): an app bar above, a bottom tab bar
 * below, one column between. It replaces `AppShell` when the person chose the
 * phone layout for this device. Like `AppShell`, the app supplies the links,
 * so `@repo/ui` never imports Next.
 *
 *   <MobileShell.Root>
 *     <MobileShell.AppBar>…</MobileShell.AppBar>
 *     <MobileShell.Main>…</MobileShell.Main>
 *     <MobileShell.TabBar>
 *       <MobileShell.Tab icon={<Receipt />} label="Collections" state="current">
 *         <Link href="/collections" />
 *       </MobileShell.Tab>
 *     </MobileShell.TabBar>
 *   </MobileShell.Root>
 */

/**
 * `--shell-bottom` is the tab bar's height, for anything that sticks to the
 * foot of the screen — a form's action row — to sit above it.
 *
 * The frame is `comfortable` density: it is for a thumb, not a mouse, so every
 * control inside is at least 44px (design-system.md, "Density").
 */
function Root({ children }: { children: ReactNode }) {
  return (
    <div
      data-density="comfortable"
      className="flex min-h-dvh flex-col bg-surface [--shell-bottom:calc(4rem+env(safe-area-inset-bottom))]"
    >
      {/*
       * Small buttons ("Show more", a row's action) are touch-sized here too.
       * Set one element down: the density rule in theme.css is unlayered and
       * would beat a utility on the element that carries `data-density`.
       */}
      <div className="contents [--control-height-sm:var(--spacing-touch)]">
        {children}
      </div>
    </div>
  );
}

/** The bar above the page, clear of a notch. */
function AppBar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-surface-raised pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2 px-[var(--page-padding)]">
        {children}
      </div>
    </header>
  );
}

/** The page, with room kept at the foot for the tab bar. */
function Main({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-[var(--section-gap)] px-[var(--page-padding)] pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
    >
      {children}
    </main>
  );
}

/** Four destinations and "More", fixed to the foot of the screen. */
function TabBar({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Console"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid h-16 max-w-3xl auto-cols-fr grid-flow-col">
        {children}
      </ul>
    </nav>
  );
}

const tab = cva(
  "flex h-full w-full flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors motion-reduce:transition-none",
  {
    variants: {
      state: {
        current: "text-accent",
        idle: "text-ink-subtle hover:text-ink",
      },
    },
  },
);

const tabPill = cva(
  "relative grid h-8 w-16 place-items-center rounded-pill transition-colors motion-reduce:transition-none [&_svg]:size-[22px]",
  {
    variants: {
      state: {
        current: "bg-accent-subtle",
        idle: "",
      },
    },
  },
);

interface TabProps {
  icon: ReactNode;
  label: string;
  state: NonNullable<VariantProps<typeof tab>["state"]>;
  /** A count on the icon: approvals or handovers waiting. */
  count?: number;
  /** The link or button, with no children: `<Link href="/cash" />`. */
  children: ReactElement<{
    className?: string;
    children?: ReactNode;
    "aria-current"?: "page";
  }>;
}

function Tab({ icon, label, state, count, children }: TabProps) {
  const shown =
    count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  const content = (
    <>
      <span className={tabPill({ state })}>
        {icon}
        {shown ? (
          <span
            aria-hidden
            data-numeric
            className="absolute -top-1 right-2 grid h-4 min-w-4 place-items-center rounded-pill bg-critical px-1 text-2xs leading-none font-semibold text-ink-inverse"
          >
            {shown}
          </span>
        ) : null}
      </span>
      <span>
        {label}
        {shown ? <span className="sr-only">, {shown} waiting</span> : null}
      </span>
    </>
  );
  const control = isValidElement(children)
    ? cloneElement(children, {
        className: cn(tab({ state })),
        "aria-current": state === "current" ? "page" : undefined,
        children: content,
      })
    : children;
  return <li className="min-w-0">{control}</li>;
}

export const MobileShell = { Root, AppBar, Main, TabBar, Tab };
