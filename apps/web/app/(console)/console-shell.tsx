"use client";

import {
  Bell,
  CaretUpDown,
  Desktop,
  DownloadSimple,
  List,
  SignOut,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Me } from "@repo/contracts";
import { AppShell, Button, Menu, Popover } from "@repo/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { GlobalSearch } from "../../components/global-search";
import { authClient } from "../../lib/auth-client";
import { navFor } from "../../lib/console-nav";
import {
  decideLayout,
  useInstalled,
  useSavedLayout,
} from "../../lib/device-layout";
import { useCanInstall } from "../../lib/install-prompt";
import { currentHref } from "../../lib/nav";
import { NotificationPanel } from "../../lib/notifications/notification-panel";
import { useUnreadCount } from "../../lib/notifications/use-unread-count";
import { ROLE_LABEL } from "../../lib/roles";
import { LANDING, SignedInContext, useMe } from "../../lib/use-me";
import { LayoutChooser, LayoutDialog } from "./layout-chooser";
import { PhoneConsole } from "./phone-console";

type ConsoleMe = Me & { role: Exclude<Me["role"], "JUNIOR"> };

/**
 * The admin console frame for Super Admin, Admin and Senior. A Junior who
 * opens a console URL is sent to their route — the console is never shown to
 * them.
 *
 * Two layouts, chosen per device (ADR-0016): the computer layout, a sidebar
 * (navigation-ia.md#responsive-behaviour), or the phone layout, a bottom tab
 * bar. The installed app asks which before it first shows the console.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const saved = useSavedLayout();
  const installed = useInstalled();
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
  const consoleMe = me as ConsoleMe;

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  const initials = me.name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const decision = decideLayout(saved, installed);

  if (decision.kind === "ask") {
    return <FirstLaunch name={me.name} />;
  }

  return (
    <SignedInContext value={me}>
      {decision.layout === "mobile" ? (
        <PhoneConsole
          me={consoleMe}
          initials={initials}
          unread={unread}
          onSignOut={() => void signOut()}
        >
          {children}
        </PhoneConsole>
      ) : (
        <ComputerConsole
          me={consoleMe}
          initials={initials}
          unread={unread}
          onSignOut={() => void signOut()}
        >
          {children}
        </ComputerConsole>
      )}
    </SignedInContext>
  );
}

/**
 * The installed app's first launch on this device: the question comes before
 * the console, so installing Rasi begins with it (ADR-0016).
 */
function FirstLaunch({ name }: { name: string }) {
  return (
    <main
      id="main"
      data-density="comfortable"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-[var(--page-padding)] py-10"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-tile bg-accent text-heading font-semibold text-accent-ink"
        >
          R
        </span>
        <span className="text-title text-ink">Rasi</span>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-display text-ink">How will you use Rasi here?</h1>
        <p className="text-body text-ink-muted">
          Welcome, {name}. Choose the layout for this device.
        </p>
      </div>
      <LayoutChooser />
    </main>
  );
}

/** The sidebar console (navigation-ia.md#responsive-behaviour, ADR-0015). */
function ComputerConsole({
  me,
  initials,
  unread,
  onSignOut,
  children,
}: {
  me: ConsoleMe;
  initials: string;
  unread: number | null;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [dialog, setDialog] = useState<"switch" | "install" | null>(null);
  const canInstall = useCanInstall();

  const groups = navFor(me.role);
  const items = groups.flatMap((group) => group.items);
  const current = currentHref(
    pathname,
    items.map((item) => item.href),
  );
  const isCurrent = (href: string) => href === current;
  const section = items.find((item) => isCurrent(item.href));

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

  return (
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
          <span className="hidden truncate text-label text-ink-muted sm:block">
            {section?.label ?? "Rasi"}
          </span>

          <GlobalSearch role={me.role} />

          <div className="ml-auto flex items-center gap-2.5">
            {/*
             * The bell opens the centre itself, rather than a page (S-21):
             * a notification is read on the way to its subject, and a page in
             * between is a stop for nothing. Radix mounts the panel only while
             * it is open, so nothing is fetched until the bell is pressed.
             */}
            <Popover.Root open={bellOpen} onOpenChange={setBellOpen}>
              <AppShell.TopbarAction
                label="Notifications"
                icon={<Bell aria-hidden />}
                count={unread ?? undefined}
              >
                <Popover.Trigger />
              </AppShell.TopbarAction>
              <Popover.Content
                align="end"
                aria-label="Notifications"
                className="flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-[var(--stack-gap)] p-4"
              >
                <h2 className="text-heading text-ink">Notifications</h2>
                <NotificationPanel onNavigate={() => setBellOpen(false)} />
              </Popover.Content>
            </Popover.Root>

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
                <Menu.Item asChild>
                  <Link href="/profile">
                    <UserCircle aria-hidden size={16} />
                    My profile
                  </Link>
                </Menu.Item>
                <Menu.Item onSelect={() => setDialog("switch")}>
                  <Desktop aria-hidden size={16} />
                  Layout: computer
                </Menu.Item>
                {canInstall ? (
                  <Menu.Item onSelect={() => setDialog("install")}>
                    <DownloadSimple aria-hidden size={16} />
                    Install Rasi on this device
                  </Menu.Item>
                ) : null}
                <Menu.Separator />
                <Menu.Item onSelect={onSignOut}>
                  <SignOut aria-hidden size={16} />
                  Sign out
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </div>
        </AppShell.Topbar>
        <AppShell.Main>{children}</AppShell.Main>
      </AppShell.Body>

      {dialog ? (
        <LayoutDialog
          purpose={dialog}
          current="desktop"
          placement="center"
          onClose={() => setDialog(null)}
        />
      ) : null}
    </AppShell.Root>
  );
}
