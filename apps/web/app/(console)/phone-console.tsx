"use client";

import {
  ArrowLeft,
  Bell,
  CaretRight,
  DeviceMobile,
  DotsThreeOutline,
  DownloadSimple,
  SignOut,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Me } from "@repo/contracts";
import { AppShell, Button, Dialog, MobileShell } from "@repo/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { GlobalSearch } from "../../components/global-search";
import { mobileNav } from "../../lib/console-nav";
import { useCanInstall } from "../../lib/install-prompt";
import { TourButton } from "../../lib/tour/tour-button";
import { currentHref } from "../../lib/nav";
import { NotificationPanel } from "../../lib/notifications/notification-panel";
import { ROLE_LABEL } from "../../lib/roles";
import { LayoutDialog } from "./layout-chooser";

/** The chip beside a tab's title: the owner is the owner, not a "Super Admin". */
const ROLE_CHIP: Record<Exclude<Me["role"], "JUNIOR">, string> = {
  SUPER_ADMIN: "Owner",
  ADMIN: "Admin",
  SENIOR: "Senior",
};

/**
 * The console in the phone layout (ADR-0016, docs/05-ux/stitch-mobile): an app
 * bar with the area and the bell, the page, and four tabs plus "More". The
 * pages are the same pages the computer layout shows; they already fold to one
 * column on a narrow screen.
 */
export function PhoneConsole({
  me,
  initials,
  unread,
  onSignOut,
  children,
}: {
  me: Me & { role: Exclude<Me["role"], "JUNIOR"> };
  initials: string;
  unread: number | null;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [dialog, setDialog] = useState<"switch" | "install" | null>(null);
  const canInstall = useCanInstall();

  const { tabs, more } = mobileNav(me.role);
  const moreItems = more.flatMap((group) => group.items);
  const current = currentHref(
    pathname,
    [...tabs, ...moreItems].map((item) => item.href),
  );
  const currentTab = tabs.find((item) => item.href === current);
  const currentMore = moreItems.find((item) => item.href === current);
  // A tab's own page shows the brand; a page beneath it gets a way back.
  const atTabRoot = currentTab !== undefined && pathname === currentTab.href;
  const area = currentTab?.label ?? currentMore?.label ?? "Rasi";

  return (
    <MobileShell.Root>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-control focus:bg-surface-raised focus:px-3 focus:py-2 focus:shadow-popover"
      >
        Skip to content
      </a>
      <MobileShell.AppBar>
        {atTabRoot ? (
          // A tab's own page (Stitch "Rasi Mobile, all roles"): who is
          // signed in, the area, and their role — a native app's top bar.
          <>
            <Link
              href="/profile"
              aria-label={`${me.name}, my profile`}
              className="grid size-10 shrink-0 place-items-center rounded-pill border border-border bg-accent-subtle text-label font-semibold text-accent"
            >
              <span aria-hidden>{initials}</span>
            </Link>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-title leading-tight text-ink">
                  {area}
                </span>
                <span className="shrink-0 rounded-control bg-accent-subtle px-1.5 py-0.5 text-2xs font-semibold tracking-wider text-accent uppercase">
                  {ROLE_CHIP[me.role]}
                </span>
              </span>
              <span className="truncate text-caption leading-none text-ink-muted">
                {me.name} · {ROLE_LABEL[me.role]}
              </span>
            </span>
          </>
        ) : (
          <>
            <Button
              tone="ghost"
              aria-label="Back"
              className="-ml-2 w-[var(--spacing-touch)] px-0"
              onClick={() => router.back()}
            >
              <ArrowLeft aria-hidden size={22} />
            </Button>
            <span className="min-w-0 flex-1 truncate text-heading text-ink">
              {area}
            </span>
          </>
        )}
        <TourButton look="appbar" />
        <GlobalSearch role={me.role} trigger="icon" />
        {/*
         * The bell opens the centre itself (S-21). On a phone that is a sheet
         * rather than the computer layout's popover: it rises under the thumb
         * and has the width to read a notification in.
         */}
        <AppShell.TopbarAction
          label="Notifications"
          icon={<Bell aria-hidden />}
          count={unread ?? undefined}
        >
          <button
            type="button"
            data-tour="bell"
            aria-haspopup="dialog"
            aria-expanded={bellOpen}
            onClick={() => setBellOpen(true)}
          />
        </AppShell.TopbarAction>
      </MobileShell.AppBar>

      <MobileShell.Main>{children}</MobileShell.Main>

      <MobileShell.TabBar>
        {tabs.map((item) => {
          const Icon = item.icon;
          const isCurrent = item === currentTab;
          return (
            <MobileShell.Tab
              key={item.href}
              icon={
                <Icon aria-hidden weight={isCurrent ? "fill" : "regular"} />
              }
              label={item.label}
              state={isCurrent ? "current" : "idle"}
            >
              <Link href={item.href} />
            </MobileShell.Tab>
          );
        })}
        <MobileShell.Tab
          icon={<DotsThreeOutline aria-hidden />}
          label="More"
          state={currentMore ? "current" : "idle"}
        >
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          />
        </MobileShell.Tab>
      </MobileShell.TabBar>

      {moreOpen ? (
        <Dialog
          open
          placement="sheet"
          onClose={() => setMoreOpen(false)}
          title="More"
        >
          {/* The account block is the way to the profile — there is no
              account menu in the phone layout. */}
          <Link
            href="/profile"
            onClick={() => setMoreOpen(false)}
            className="flex min-h-14 items-center gap-3 rounded-surface border border-border bg-surface p-3 transition-colors hover:bg-surface-sunken"
          >
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent-subtle text-label font-semibold text-accent"
            >
              {initials}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-heading text-ink">{me.name}</span>
              <span className="text-caption text-ink-muted">
                {ROLE_LABEL[me.role]} · My profile
              </span>
            </span>
            <UserCircle aria-hidden size={20} className="text-ink-subtle" />
          </Link>

          <nav aria-label="More" className="flex flex-col gap-4">
            {more.map((group) => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <h3 className="px-1 text-caption text-ink-subtle">
                  {group.title}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-surface border border-border">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={
                            item === currentMore ? "page" : undefined
                          }
                          className="flex min-h-14 items-center gap-3 bg-surface-raised px-3 text-body text-ink transition-colors hover:bg-surface-sunken aria-[current=page]:bg-accent-subtle"
                        >
                          <span
                            aria-hidden
                            className="grid size-9 shrink-0 place-items-center rounded-tile bg-accent-subtle text-accent"
                          >
                            <Icon size={20} />
                          </span>
                          <span className="flex-1">{item.label}</span>
                          <CaretRight
                            aria-hidden
                            size={16}
                            className="text-ink-subtle"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>

          <div className="flex flex-col gap-2">
            <Button
              tone="secondary"
              className="w-full"
              onClick={() => {
                setMoreOpen(false);
                setDialog("switch");
              }}
            >
              <DeviceMobile aria-hidden size={18} />
              Layout: phone
            </Button>
            {canInstall ? (
              <Button
                tone="secondary"
                className="w-full"
                onClick={() => {
                  setMoreOpen(false);
                  setDialog("install");
                }}
              >
                <DownloadSimple aria-hidden size={18} />
                Install Rasi on this device
              </Button>
            ) : null}
            <Button tone="ghost" className="w-full" onClick={onSignOut}>
              <SignOut aria-hidden size={18} />
              Sign out
            </Button>
          </div>
        </Dialog>
      ) : null}

      {bellOpen ? (
        <Dialog
          open
          placement="sheet"
          onClose={() => setBellOpen(false)}
          title="Notifications"
        >
          <NotificationPanel onNavigate={() => setBellOpen(false)} />
        </Dialog>
      ) : null}

      {dialog ? (
        <LayoutDialog
          purpose={dialog}
          current="mobile"
          placement="sheet"
          onClose={() => setDialog(null)}
        />
      ) : null}
    </MobileShell.Root>
  );
}
