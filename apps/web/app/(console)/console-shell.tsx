"use client";

import {
  AddressBook,
  Bell,
  CalendarBlank,
  CaretUpDown,
  ChartBar,
  ClipboardText,
  List,
  MapTrifold,
  Money,
  Path,
  Receipt,
  ShieldWarning,
  SignOut,
  SlidersHorizontal,
  SquaresFour,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { AppShell, Button, Menu } from "@repo/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { authClient } from "../../lib/auth-client";
import { currentHref } from "../../lib/nav";
import { useUnreadCount } from "../../lib/notifications/use-unread-count";
import {
  canManageOrganisation,
  ROLE_LABEL,
  type Role,
  seesReports,
  seesSettings,
} from "../../lib/roles";
import { LANDING, SignedInContext, useMe } from "../../lib/use-me";

interface NavItem {
  href: string;
  label: string;
  icon: typeof SquaresFour;
  shownTo: (role: Role) => boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const everyone = () => true;

/**
 * navigation-ia.md#navigation-by-role — only the areas that exist so far,
 * grouped by what a person is doing: running today's money, looking after the
 * records, or the system itself. A link to an unbuilt page is not added early.
 * Hidden, not disabled: a role without the area does not see the link.
 */
const NAV: NavGroup[] = [
  {
    title: "Operate",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: SquaresFour,
        shownTo: everyone,
      },
      {
        href: "/collections",
        label: "Collections",
        icon: Receipt,
        shownTo: everyone,
      },
      { href: "/cash", label: "Cash", icon: Money, shownTo: everyone },
      // M12: Admins, and a Senior for their own line (US-084 onwards).
      {
        href: "/reports",
        label: "Reports",
        icon: ChartBar,
        shownTo: seesReports,
      },
    ],
  },
  {
    title: "Records",
    items: [
      {
        href: "/customers",
        label: "Customers",
        icon: AddressBook,
        shownTo: everyone,
      },
      { href: "/lines", label: "Lines", icon: Path, shownTo: everyone },
      {
        href: "/sectors",
        label: "Sectors",
        icon: MapTrifold,
        shownTo: canManageOrganisation,
      },
      { href: "/team", label: "Team", icon: UsersThree, shownTo: everyone },
    ],
  },
  {
    title: "System",
    items: [
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        shownTo: everyone,
      },
      // M06: every role reads the holidays; only Admins change them (US-093).
      {
        href: "/settings/holidays",
        label: "Holidays",
        icon: CalendarBlank,
        shownTo: everyone,
      },
      {
        href: "/settings/audit",
        label: "Audit log",
        icon: ClipboardText,
        shownTo: canManageOrganisation,
      },
      // M13: the other half — what was tried and turned away (ADR-0014).
      {
        href: "/settings/security",
        label: "Refused attempts",
        icon: ShieldWarning,
        shownTo: canManageOrganisation,
      },
      // M15: the business's own settings, the Super Admin's alone (US-094).
      {
        href: "/settings",
        label: "Business settings",
        icon: SlidersHorizontal,
        shownTo: seesSettings,
      },
    ],
  },
];

/**
 * The admin console frame for Super Admin, Admin and Senior
 * (navigation-ia.md#responsive-behaviour). A Junior who opens a console URL is
 * sent to their route — the console shell is never shown to them.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The bell (navigation-ia.md#notifications): polled, never for a Junior.
  const unread = useUnreadCount(Boolean(me) && me?.role !== "JUNIOR");

  useEffect(() => {
    if (me?.role === "JUNIOR") router.replace(LANDING.JUNIOR);
  }, [me, router]);

  if (!me || me.role === "JUNIOR") {
    return (
      <p className="sr-only" role="status">
        Loading
      </p>
    );
  }

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.shownTo(me.role)),
  })).filter((group) => group.items.length > 0);
  const items = groups.flatMap((group) => group.items);
  const current = currentHref(
    pathname,
    items.map((item) => item.href),
  );
  const isCurrent = (href: string) => href === current;
  const section = items.find((item) => isCurrent(item.href));

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  const navigation = groups.map((group) => (
    <AppShell.NavSection key={group.title} title={group.title}>
      {group.items.map((item) => {
        const Icon = item.icon;
        return (
          <AppShell.NavItem
            key={item.href}
            icon={<Icon aria-hidden size={18} />}
            label={item.label}
            state={isCurrent(item.href) ? "current" : "idle"}
            count={
              item.href === "/notifications" ? (unread ?? undefined) : undefined
            }
          >
            <Link href={item.href} />
          </AppShell.NavItem>
        );
      })}
    </AppShell.NavSection>
  ));

  const brand = (
    <Link
      href="/dashboard"
      aria-label="Rasi — dashboard"
      className="flex items-center gap-3"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-tile bg-accent text-heading font-semibold text-accent-ink"
      >
        R
      </span>
      <span aria-hidden className="text-title text-ink">
        <AppShell.RailLabel>Rasi</AppShell.RailLabel>
      </span>
    </Link>
  );

  const initials = me.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SignedInContext value={me}>
      <AppShell.Root>
        <AppShell.Sidebar brand={brand}>{navigation}</AppShell.Sidebar>
        <AppShell.Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          brand={brand}
        >
          {navigation}
        </AppShell.Drawer>

        <AppShell.Body>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-control focus:bg-surface-raised focus:px-3 focus:py-2 focus:shadow-popover"
          >
            Skip to content
          </a>
          <AppShell.Topbar>
            <Button
              tone="ghost"
              size="sm"
              className="md:hidden"
              aria-label="Open navigation"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <List aria-hidden size={20} />
            </Button>
            <AppShell.SidebarToggle />
            <span className="truncate text-label text-ink-muted">
              {section?.label ?? "Rasi"}
            </span>

            <div className="ml-auto flex items-center gap-2.5">
              <AppShell.TopbarAction
                label="Notifications"
                icon={<Bell aria-hidden />}
                count={unread ?? undefined}
              >
                <Link href="/notifications" />
              </AppShell.TopbarAction>

              <Menu.Root>
                <Menu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={`${me.name}, ${ROLE_LABEL[me.role]} — account menu`}
                    className="flex items-center gap-2.5 rounded-pill p-0.5 pr-2 text-left transition-colors hover:bg-ink/5"
                  >
                    <span
                      aria-hidden
                      className="grid size-9 place-items-center rounded-pill bg-accent-subtle text-label font-semibold text-accent"
                    >
                      {initials}
                    </span>
                    <span
                      aria-hidden
                      className="hidden flex-col leading-tight sm:flex"
                    >
                      <span className="max-w-40 truncate text-label text-ink">
                        {me.name}
                      </span>
                      <span className="text-2xs text-ink-muted">
                        {ROLE_LABEL[me.role]}
                      </span>
                    </span>
                    <CaretUpDown
                      aria-hidden
                      size={12}
                      className="text-ink-subtle"
                    />
                  </button>
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Label>
                    <span className="text-label text-ink">{me.name}</span>
                    <span>{ROLE_LABEL[me.role]}</span>
                  </Menu.Label>
                  <Menu.Separator />
                  <Menu.Item onSelect={() => void signOut()}>
                    <SignOut aria-hidden size={16} />
                    Sign out
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </div>
          </AppShell.Topbar>
          <AppShell.Main>{children}</AppShell.Main>
        </AppShell.Body>
      </AppShell.Root>
    </SignedInContext>
  );
}
