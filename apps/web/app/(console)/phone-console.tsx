"use client";

import {
  ArrowLeft,
  Bell,
  CaretRight,
  DeviceMobile,
  DotsThreeOutline,
  DownloadSimple,
  SignOut,
} from "@phosphor-icons/react/dist/ssr";
import type { Me } from "@repo/contracts";
import { AppShell, Button, Dialog, MobileShell } from "@repo/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { mobileNav } from "../../lib/console-nav";
import { useCanInstall } from "../../lib/install-prompt";
import { currentHref } from "../../lib/nav";
import { ROLE_LABEL } from "../../lib/roles";
import { LayoutDialog } from "./layout-chooser";

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
          <Link
            href="/dashboard"
            aria-label="Rasi, dashboard"
            className="grid size-[var(--spacing-touch)] shrink-0 place-items-center rounded-tile bg-accent text-heading font-semibold text-accent-ink"
          >
            <span aria-hidden>R</span>
          </Link>
        ) : (
          <Button
            tone="ghost"
            aria-label="Back"
            className="-ml-2 w-[var(--spacing-touch)] px-0"
            onClick={() => router.back()}
          >
            <ArrowLeft aria-hidden size={22} />
          </Button>
        )}
        <span className="min-w-0 flex-1 truncate text-heading text-ink">
          {area}
        </span>
        <AppShell.TopbarAction
          label="Notifications"
          icon={<Bell aria-hidden />}
          count={unread ?? undefined}
        >
          <Link href="/notifications" />
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
          <div className="flex items-center gap-3 rounded-surface border border-border bg-surface p-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent-subtle text-label font-semibold text-accent"
            >
              {initials}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-heading text-ink">{me.name}</span>
              <span className="text-caption text-ink-muted">
                {ROLE_LABEL[me.role]}
              </span>
            </span>
          </div>

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
                          {item.href === "/notifications" && unread ? (
                            <span
                              data-numeric
                              className="rounded-pill bg-critical px-1.5 text-2xs leading-4 font-semibold text-ink-inverse"
                            >
                              {unread}
                              <span className="sr-only"> unread</span>
                            </span>
                          ) : null}
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
