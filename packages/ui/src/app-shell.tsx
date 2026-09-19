"use client";

import { SidebarSimple, X } from "@phosphor-icons/react/dist/ssr";
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
  useSyncExternalStore,
} from "react";

import { Button } from "./button";
import { cn } from "./cn";
import { useBackdropPress } from "./dialog";

/**
 * The console frame (navigation-ia.md#responsive-behaviour, ADR-0015): a
 * sidebar on its own tinted layer, whose current item is a tab joined to the
 * page. From 1280px it shows labels, or — pinned to a rail with the toggle —
 * icons only; from 768px it is always the rail. The rail opens over the page
 * while the pointer or keyboard focus is in it. Below 768px it is a drawer.
 * The pieces are generic — the app supplies the links, so `@repo/ui` never
 * imports Next.
 *
 *   <AppShell.Root>
 *     <AppShell.Sidebar brand={…} footer={…}>
 *       <AppShell.NavSection title="Operate">
 *         <AppShell.NavItem icon={<Receipt />} label="Collections" state="current">
 *           <Link href="/collections" />
 *         </AppShell.NavItem>
 *       </AppShell.NavSection>
 *     </AppShell.Sidebar>
 *     <AppShell.Body>
 *       <AppShell.Topbar>…<AppShell.SidebarToggle />…</AppShell.Topbar>
 *       <AppShell.Main>…</AppShell.Main>
 *     </AppShell.Body>
 *   </AppShell.Root>
 */

/* -------------------------------------------------------------------------
 * The sidebar's mode, remembered per browser. Storage can be missing or throw
 * (a private window, blocked site data); the mode then lives in memory.
 * ---------------------------------------------------------------------- */

export type SidebarMode = "expanded" | "rail";

const MODE_KEY = "rasi.console.sidebar";
let remembered: SidebarMode | null = null;
const listeners = new Set<() => void>();

function readMode(): SidebarMode {
  if (remembered) return remembered;
  try {
    return window.localStorage.getItem(MODE_KEY) === "rail"
      ? "rail"
      : "expanded";
  } catch {
    return "expanded";
  }
}

function writeMode(mode: SidebarMode) {
  remembered = mode;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Kept in memory for this page's life.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== MODE_KEY) return;
    remembered = null;
    listener();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
  };
}

/** The sidebar's mode from 1280px, and a setter that remembers it. */
export function useSidebarMode() {
  const mode = useSyncExternalStore(
    subscribe,
    readMode,
    (): SidebarMode => "expanded",
  );
  return [mode, writeMode] as const;
}

/* ---------------------------------------------------------------------- */

type NavPlacement = "rail" | "drawer";
const NavPlacementContext = createContext<NavPlacement>("drawer");

function Root({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-surface md:flex">{children}</div>;
}

/**
 * Text that shows only while the sidebar is wide — labelled, or a rail being
 * peeked at. It stays in the accessibility tree either way, so a rail link
 * keeps its name.
 */
const revealed =
  "opacity-0 transition-opacity duration-200 motion-reduce:transition-none group-hover/sidebar:opacity-100 group-has-[:focus-visible]/sidebar:opacity-100 xl:group-data-[mode=expanded]/sidebar:opacity-100";

/** A piece of the brand that only shows with labels: the product's name. */
function RailLabel({ children }: { children: ReactNode }) {
  const placement = use(NavPlacementContext);
  return (
    <span className={cn("whitespace-nowrap", placement === "rail" && revealed)}>
      {children}
    </span>
  );
}

interface SidebarProps {
  /** The product mark, linked to the landing page. */
  brand: ReactNode;
  children: ReactNode;
  /** Pinned to the bottom: the signed-in person. */
  footer?: ReactNode;
}

function Sidebar({ brand, children, footer }: SidebarProps) {
  const [mode] = useSidebarMode();
  return (
    <NavPlacementContext value="rail">
      {/* The column the page keeps for the sidebar; the aside can open past it. */}
      <div
        data-mode={mode}
        className="group/sidebar relative z-30 hidden w-[4.375rem] shrink-0 md:block xl:data-[mode=expanded]:w-[15.625rem]"
      >
        <aside
          id="console-sidebar"
          className={cn(
            "sticky top-0 flex h-dvh w-[4.375rem] flex-col overflow-hidden bg-surface-nav",
            "transition-[width,box-shadow] duration-300 ease-out motion-reduce:transition-none",
            "group-hover/sidebar:w-[15.625rem] group-hover/sidebar:shadow-overlay",
            "group-has-[:focus-visible]/sidebar:w-[15.625rem] group-has-[:focus-visible]/sidebar:shadow-overlay",
            "xl:group-data-[mode=expanded]/sidebar:w-[15.625rem] xl:group-data-[mode=expanded]/sidebar:shadow-none",
          )}
        >
          <div className="flex h-[var(--header-height)] shrink-0 items-center px-[1.0625rem]">
            {brand}
          </div>
          {/* Top padding leaves room for the first tab's upper corner. */}
          <nav
            aria-label="Console"
            className="flex flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto pt-7 pb-6 pl-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {children}
          </nav>
          {footer ? <div className="shrink-0 p-2.5">{footer}</div> : null}
        </aside>
      </div>
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
        className="m-0 h-dvh max-h-dvh w-72 max-w-[calc(100vw-3rem)] bg-surface-nav p-0 text-ink backdrop:bg-ink/35 open:animate-in"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between px-4">
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
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3 [scrollbar-width:thin]"
            onClick={onClose}
          >
            {children}
          </nav>
          {footer ? <div className="shrink-0 p-3">{footer}</div> : null}
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
    <div className="flex flex-col gap-1">
      <p
        className={cn(
          "px-3 pb-1 text-2xs font-medium tracking-wider whitespace-nowrap text-ink-muted uppercase",
          placement === "rail" && revealed,
        )}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

/**
 * The current item is a tab cut out of the sidebar and joined to the page:
 * its row takes the page's colour, and two circles in the sidebar's colour,
 * shadowed with the page's, draw the inverted corners above and below it.
 */
const navItem = cva(
  "group/nav relative flex items-center gap-3 text-label transition-colors motion-reduce:transition-none",
  {
    variants: {
      state: {
        current: "text-ink",
        idle: "text-ink-muted hover:text-ink",
      },
      placement: {
        rail: "h-12.5 pr-3 pl-[0.4375rem]",
        drawer: "h-11 rounded-control px-2",
      },
    },
    compoundVariants: [
      {
        state: "current",
        placement: "rail",
        className: [
          "rounded-l-nav bg-surface",
          "before:pointer-events-none before:absolute before:-top-12.5 before:right-0 before:size-12.5 before:rounded-pill before:bg-surface-nav before:shadow-[35px_35px_0_10px_var(--color-surface)] before:content-['']",
          "after:pointer-events-none after:absolute after:top-12.5 after:right-0 after:size-12.5 after:rounded-pill after:bg-surface-nav after:shadow-[35px_-35px_0_10px_var(--color-surface)] after:content-['']",
        ],
      },
      {
        state: "idle",
        placement: "rail",
        className: "rounded-r-pill hover:bg-ink/5",
      },
      { state: "current", placement: "drawer", className: "bg-surface" },
      { state: "idle", placement: "drawer", className: "hover:bg-ink/5" },
    ],
  },
);

const navTile = cva(
  "relative z-[1] grid size-9 shrink-0 place-items-center rounded-tile transition-colors motion-reduce:transition-none [&_svg]:size-[18px]",
  {
    variants: {
      state: {
        current: "bg-accent text-accent-ink",
        idle: "bg-surface text-ink-muted group-hover/nav:text-ink",
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
      <span className={navTile({ state })}>
        {icon}
        {shown && placement === "rail" ? (
          // On the tile while the rail is narrow; beside the label once it is wide.
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 min-w-4 rounded-pill bg-critical px-1 text-center text-2xs leading-4 font-semibold text-ink-inverse transition-opacity group-hover/sidebar:opacity-0 group-has-[:focus-visible]/sidebar:opacity-0 xl:group-data-[mode=expanded]/sidebar:opacity-0"
          >
            {shown}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "relative z-[1] truncate",
          placement === "rail" && revealed,
        )}
      >
        {label}
      </span>
      {shown ? (
        <span
          data-numeric
          className={cn(
            "relative z-[1] ml-auto rounded-pill bg-critical px-1.5 text-2xs leading-4 font-semibold text-ink-inverse",
            placement === "rail" && revealed,
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

  return <li>{link}</li>;
}

function Body({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}

/**
 * The bar above the page: glass over the scrolling content, solid where the
 * browser cannot blur. The drawer button on a phone, then the app's tools.
 */
function Topbar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height)] shrink-0 items-center gap-2 bg-surface px-[var(--page-padding)] supports-[backdrop-filter:blur(1px)]:bg-surface/75 supports-[backdrop-filter:blur(1px)]:backdrop-blur-md">
      {children}
    </header>
  );
}

/** From 1280px: labels, or icons only. Remembered per browser. */
function SidebarToggle() {
  const [mode, setMode] = useSidebarMode();
  const expanded = mode === "expanded";
  return (
    <button
      type="button"
      aria-label="Navigation labels"
      aria-controls="console-sidebar"
      aria-expanded={expanded}
      onClick={() => setMode(expanded ? "rail" : "expanded")}
      className="hidden size-9 place-items-center rounded-tile text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink xl:inline-grid"
    >
      <SidebarSimple aria-hidden size={20} />
    </button>
  );
}

interface TopbarActionProps {
  /** Names the action for a screen reader: the icon alone says nothing. */
  label: string;
  icon: ReactNode;
  /** A count on the button's corner — unread notifications. */
  count?: number;
  /** The link or button, with no children: `<Link href="/notifications" />`. */
  children: ReactElement<{
    className?: string;
    children?: ReactNode;
    "aria-label"?: string;
  }>;
}

/** A round icon action in the top bar, with an optional count. */
function TopbarAction({ label, icon, count, children }: TopbarActionProps) {
  const shown =
    count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  return cloneElement(children, {
    "aria-label": shown ? `${label}, ${shown} unread` : label,
    className:
      "relative grid size-10 shrink-0 place-items-center rounded-pill bg-surface-raised text-ink-muted shadow-raised transition-colors hover:text-ink [&_svg]:size-5",
    children: (
      <>
        {icon}
        {shown ? (
          <span
            aria-hidden
            data-numeric
            className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-pill bg-critical px-1 text-2xs leading-none font-semibold text-ink-inverse"
          >
            {shown}
          </span>
        ) : null}
      </>
    ),
  });
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
  RailLabel,
  NavSection,
  NavItem,
  Body,
  Topbar,
  SidebarToggle,
  TopbarAction,
  Main,
};
