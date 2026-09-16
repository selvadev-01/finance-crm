"use client";

import {
  AddressBook,
  Bell,
  ClipboardText,
  List,
  Money,
  MapTrifold,
  Path,
  Receipt,
  SignOut,
  SquaresFour,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button, cn, useBackdropPress } from "@repo/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { authClient } from "../../lib/auth-client";
import { useUnreadCount } from "../../lib/notifications/use-unread-count";
import { canManageOrganisation, ROLE_LABEL, type Role } from "../../lib/roles";
import { LANDING, SignedInContext, useMe } from "../../lib/use-me";

interface NavItem {
  href: string;
  label: string;
  icon: typeof SquaresFour;
  shownTo: (role: Role) => boolean;
}

/**
 * navigation-ia.md#navigation-by-role — only the areas that exist so far.
 * Reports and Settings join as
 * their screens are built; a link to an unbuilt page is not added early.
 * Hidden, not disabled: a role without the area does not see the link.
 */
const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: SquaresFour,
    shownTo: () => true,
  },
  {
    href: "/customers",
    label: "Customers",
    icon: AddressBook,
    shownTo: () => true,
  },
  {
    href: "/sectors",
    label: "Sectors",
    icon: MapTrifold,
    shownTo: canManageOrganisation,
  },
  { href: "/lines", label: "Lines", icon: Path, shownTo: () => true },
  {
    href: "/collections",
    label: "Collections",
    icon: Receipt,
    shownTo: () => true,
  },
  { href: "/cash", label: "Cash", icon: Money, shownTo: () => true },
  { href: "/team", label: "Team", icon: UsersThree, shownTo: () => true },
  {
    href: "/notifications",
    label: "Notifications",
    icon: Bell,
    shownTo: () => true,
  },
  {
    href: "/settings/audit",
    label: "Audit log",
    icon: ClipboardText,
    shownTo: canManageOrganisation,
  },
];

/**
 * The admin console frame for Super Admin, Admin and Senior: a sidebar from
 * 1280px, icons only from 768px, a drawer below (navigation-ia.md#responsive-behaviour).
 * A Junior who opens a console URL is sent to their route — the console shell
 * is never shown to them.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const drawerBackdrop = useBackdropPress(() => setDrawerOpen(false));
  // The bell (navigation-ia.md#notifications): polled, never for a Junior.
  const unread = useUnreadCount(Boolean(me) && me?.role !== "JUNIOR");

  useEffect(() => {
    if (me?.role === "JUNIOR") router.replace(LANDING.JUNIOR);
  }, [me, router]);

  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) dialog.showModal();
    if (!drawerOpen && dialog.open) dialog.close();
  }, [drawerOpen]);

  if (!me || me.role === "JUNIOR") {
    return (
      <p className="sr-only" role="status">
        Loading
      </p>
    );
  }

  const items = NAV.filter((item) => item.shownTo(me.role));
  const isCurrent = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  const navLinks = (layout: "rail" | "drawer") => (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const current = isCurrent(item.href);
        const Icon = item.icon;
        const count = item.href === "/notifications" ? unread : null;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              title={layout === "rail" ? item.label : undefined}
              onClick={() => setDrawerOpen(false)}
              className={cn(
                "flex h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-2.5 text-sm font-medium transition-colors",
                layout === "rail" && "justify-center xl:justify-start",
                current
                  ? "bg-accent-subtle text-accent"
                  : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
              )}
            >
              <span className="relative shrink-0">
                <Icon aria-hidden size={20} weight="regular" />
                {count ? (
                  <UnreadDot
                    count={count}
                    className={cn(layout === "rail" && "xl:hidden")}
                  />
                ) : null}
              </span>
              <span
                className={cn(layout === "rail" && "sr-only xl:not-sr-only")}
              >
                {item.label}
              </span>
              {count ? (
                <span
                  data-numeric
                  className={cn(
                    "ml-auto rounded-full bg-critical px-1.5 text-2xs font-semibold text-ink-inverse",
                    layout === "rail" && "hidden xl:inline",
                  )}
                >
                  {count}
                  <span className="sr-only"> unread</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const identity = (layout: "rail" | "drawer") => (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className={cn(layout === "rail" && "hidden xl:block")}>
        <p className="truncate text-sm font-medium text-ink">{me.name}</p>
        <p className="text-2xs text-ink-muted">{ROLE_LABEL[me.role]}</p>
      </div>
      <Button
        tone="ghost"
        onClick={signOut}
        title={layout === "rail" ? "Sign out" : undefined}
        className={cn(
          "justify-start px-2.5",
          layout === "rail" && "justify-center xl:justify-start",
        )}
      >
        <SignOut aria-hidden size={20} weight="regular" className="shrink-0" />
        <span className={cn(layout === "rail" && "sr-only xl:not-sr-only")}>
          Sign out
        </span>
      </Button>
    </div>
  );

  return (
    <SignedInContext value={me}>
      <div className="min-h-dvh md:flex">
        <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col gap-4 border-r border-border bg-surface-raised px-2 py-4 md:flex xl:w-60 xl:px-3">
          <Link
            href="/dashboard"
            className="px-2.5 text-lg font-semibold text-ink"
            aria-label="Rasi — dashboard"
          >
            <span aria-hidden className="xl:hidden">
              R
            </span>
            <span aria-hidden className="hidden xl:inline">
              Rasi
            </span>
          </Link>
          <nav aria-label="Console" className="flex-1">
            {navLinks("rail")}
          </nav>
          {identity("rail")}
        </aside>

        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-raised px-2 py-2 md:hidden">
          <Button
            tone="ghost"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="px-2.5"
          >
            <List aria-hidden size={22} weight="regular" />
          </Button>
          <span className="flex-1 text-base font-semibold text-ink">Rasi</span>
          <Link
            href="/notifications"
            aria-label={
              unread ? `Notifications, ${unread} unread` : "Notifications"
            }
            className="relative flex h-[var(--control-height)] items-center rounded-[var(--radius-control)] px-2.5 text-ink hover:bg-surface-sunken"
          >
            <Bell aria-hidden size={22} weight="regular" />
            {unread ? <UnreadDot count={unread} /> : null}
          </Link>
        </header>

        <dialog
          ref={drawer}
          aria-label="Navigation"
          onCancel={(event) => {
            event.preventDefault();
            setDrawerOpen(false);
          }}
          {...drawerBackdrop}
          className="m-0 h-dvh max-h-dvh w-72 max-w-[calc(100vw-3rem)] border-r border-border bg-surface-raised p-0 backdrop:bg-ink/40"
        >
          <div className="flex h-full flex-col gap-4 px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="px-2.5 text-lg font-semibold text-ink">
                Rasi
              </span>
              <Button
                tone="ghost"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="px-2.5"
              >
                <X aria-hidden size={20} weight="regular" />
              </Button>
            </div>
            <nav aria-label="Console" className="flex-1">
              {navLinks("drawer")}
            </nav>
            {identity("drawer")}
          </div>
        </dialog>

        <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </SignedInContext>
  );
}

/** The count on the bell icon; the full count is also spoken where it is shown. */
function UnreadDot({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-numeric
      className={cn(
        "absolute -top-1.5 -right-2 min-w-4 rounded-full bg-critical px-1 text-center text-2xs leading-4 font-semibold text-ink-inverse",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
