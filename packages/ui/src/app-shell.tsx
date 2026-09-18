"use client";

import { X } from "@phosphor-icons/react/dist/ssr";
import { cva, type VariantProps } from "class-variance-authority";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  use,
  useEffect,
  useRef,
} from "react";

import { Button } from "./button";
import { cn } from "./cn";
import { useBackdropPress } from "./dialog";
import { Tooltip } from "./tooltip";

/**
 * The console frame (navigation-ia.md#responsive-behaviour): a sidebar with
 * labels from 1280px, icons only from 768px, a drawer below. The pieces are
 * generic — the app supplies the links, so `@repo/ui` never imports Next.
 *
 *   <AppShell.Root>
 *     <AppShell.Sidebar brand={…} footer={…}>
 *       <AppShell.NavSection title="Operate">
 *         <AppShell.NavItem icon={<Receipt />} label="Collections" current>
 *           <Link href="/collections" />
 *         </AppShell.NavItem>
 *       </AppShell.NavSection>
 *     </AppShell.Sidebar>
 *     <AppShell.Body>
 *       <AppShell.Topbar>…</AppShell.Topbar>
 *       <AppShell.Main>…</AppShell.Main>
 *     </AppShell.Body>
 *   </AppShell.Root>
 */

type NavPlacement = "rail" | "drawer";
const NavPlacementContext = createContext<NavPlacement>("drawer");

function Root({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-surface md:flex">{children}</div>;
}

interface SidebarProps {
  /** The product mark, linked to the landing page. */
  brand: ReactNode;
  children: ReactNode;
  /** Pinned to the bottom: the signed-in person. */
  footer?: ReactNode;
}

function Sidebar({ brand, children, footer }: SidebarProps) {
  return (
    <NavPlacementContext value="rail">
      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r border-border bg-surface-raised md:flex xl:w-60">
        <div className="flex h-[var(--header-height)] shrink-0 items-center justify-center border-b border-border px-3 xl:justify-start xl:px-4">
          {brand}
        </div>
        <nav
          aria-label="Console"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3 xl:px-3"
        >
          {children}
        </nav>
        {footer ? (
          <div className="shrink-0 border-t border-border p-2 xl:p-3">
            {footer}
          </div>
        ) : null}
      </aside>
    </NavPlacementContext>
  );
}

interface DrawerProps extends SidebarProps {
  open: boolean;
  onClose: () => void;
}

/** The sidebar below 768px, in a native modal `<dialog>`. */
function Drawer({ open, onClose, brand, children, footer }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useBackdropPress(onClose);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <NavPlacementContext value="drawer">
      <dialog
        ref={ref}
        aria-label="Navigation"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        {...backdropPress}
        className="m-0 h-dvh max-h-dvh w-72 max-w-[calc(100vw-3rem)] border-r border-border bg-surface-raised p-0 text-ink backdrop:bg-ink/35 open:animate-in"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-border px-4">
            {brand}
            <Button
              tone="ghost"
              size="sm"
              aria-label="Close navigation"
              onClick={onClose}
            >
              <X aria-hidden size={18} />
            </Button>
          </div>
          <nav
            aria-label="Console"
            className="flex flex-1 flex-col gap-4 overflow-y-auto p-3"
            onClick={onClose}
          >
            {children}
          </nav>
          {footer ? (
            <div className="shrink-0 border-t border-border p-3">{footer}</div>
          ) : null}
        </div>
      </dialog>
    </NavPlacementContext>
  );
}

function NavSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const placement = use(NavPlacementContext);
  return (
    <div className="flex flex-col gap-0.5">
      <p
        className={cn(
          "px-2.5 pb-1 text-2xs font-medium tracking-wider text-ink-subtle uppercase",
          placement === "rail" && "sr-only xl:not-sr-only",
        )}
      >
        {title}
      </p>
      {placement === "rail" ? (
        <hr aria-hidden className="mx-2 mb-1 border-border xl:hidden" />
      ) : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

const navItem = cva(
  [
    "relative flex h-9 items-center gap-3 rounded-control px-2.5 text-label transition-colors",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      state: {
        current:
          "bg-accent-subtle text-accent before:absolute before:inset-y-1.5 before:-left-2 before:w-0.5 before:rounded-pill before:bg-accent xl:before:-left-3",
        idle: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
      },
      placement: {
        rail: "justify-center xl:justify-start",
        drawer: "",
      },
    },
  },
);

interface NavItemProps {
  icon: ReactNode;
  label: string;
  /** Whether this is the section the reader is in. */
  state: NonNullable<VariantProps<typeof navItem>["state"]>;
  /** A count to draw attention to — unread notifications. */
  count?: number;
  /** The link element, with no children: `<Link href="/customers" />`. */
  children: ReactElement<{
    className?: string;
    children?: ReactNode;
    "aria-current"?: "page";
  }>;
}

function NavItem({ icon, label, state, count, children }: NavItemProps) {
  const placement = use(NavPlacementContext);
  const shown =
    count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  const content = (
    <>
      <span className="relative">
        {icon}
        {shown && placement === "rail" ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-2 min-w-4 rounded-pill bg-critical px-1 text-center text-2xs leading-4 font-semibold text-ink-inverse xl:hidden"
          >
            {shown}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "truncate",
          placement === "rail" && "sr-only xl:not-sr-only",
        )}
      >
        {label}
      </span>
      {shown ? (
        <span
          data-numeric
          className={cn(
            "ml-auto rounded-pill bg-critical px-1.5 text-2xs leading-4 font-semibold text-ink-inverse",
            placement === "rail" && "hidden xl:inline",
          )}
        >
          {shown}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
    </>
  );
  const link = isValidElement(children)
    ? cloneElement(children, {
        className: navItem({ state, placement }),
        "aria-current": state === "current" ? "page" : undefined,
        children: content,
      })
    : children;

  return (
    <li>
      {placement === "rail" ? (
        <Tooltip content={label} side="right" className="xl:hidden">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}

/** The bar above the page: the drawer button on a phone, then the app's tools. */
function Topbar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-[var(--page-padding)]">
      {children}
    </header>
  );
}

const main = cva(
  "mx-auto flex w-full min-w-0 flex-col gap-[var(--section-gap)] px-[var(--page-padding)] py-6 md:py-8",
  {
    variants: {
      width: {
        /** Detail pages and forms: a readable measure. */
        default: "max-w-6xl",
        /** Lists with many columns. */
        wide: "max-w-screen-2xl",
      },
    },
    defaultVariants: { width: "default" },
  },
);

function Main({
  children,
  width,
}: { children: ReactNode } & VariantProps<typeof main>) {
  return (
    <main id="main" className={main({ width })}>
      {children}
    </main>
  );
}

export const AppShell = {
  Root,
  Sidebar,
  Drawer,
  NavSection,
  NavItem,
  Body,
  Topbar,
  Main,
};
