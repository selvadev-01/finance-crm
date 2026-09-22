"use client";

import {
  ArrowLeft,
  Bell,
  CheckCircle,
  CloudCheck,
  CloudSlash,
  Path,
  Receipt,
  UserCircle,
  UsersThree,
  Wallet,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@repo/ui";
import { type ComponentType, createContext, type ReactNode, use } from "react";

import {
  backTarget,
  goBack,
  openView,
  switchTab,
  type Tab,
  TAB_HASH,
} from "./hash-view";

/**
 * The field app's native chrome (J-01…J-08): a Material 3 top app bar on every
 * screen, a bottom navigation bar on the four tabs, banners under the bar and
 * a snackbar over the tabs. "Is my day safe" is answered on every screen
 * without a tap — the sync chip names the connection and what is still on
 * the phone, and opens Sync (offline-sync.md#status-visibility).
 */
export function TopAppBar({
  title,
  subtitle,
  back = false,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A screen opened over a tab: the arrow returns to it. */
  back?: boolean;
  actions?: ReactNode;
}) {
  const target = back ? backTarget() : null;
  return (
    <header
      className="sticky top-0 z-20 flex min-h-16 items-center gap-1 border-b border-border bg-surface-raised px-2 pt-[env(safe-area-inset-top)]"
      data-testid="status-bar"
    >
      {back ? (
        <button
          type="button"
          onClick={goBack}
          aria-label={`Back to ${TAB_LABEL[target ?? "route"].toLowerCase()}`}
          className="flex size-12 shrink-0 items-center justify-center rounded-pill text-ink hover:bg-surface-sunken active:bg-surface-sunken"
        >
          <ArrowLeft aria-hidden size={24} weight="regular" />
        </button>
      ) : null}
      <div className={cn("flex min-w-0 flex-1 flex-col py-2", !back && "pl-2")}>
        <h1 className="truncate text-xl leading-7 font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-sm text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * Connection and what is still on the phone, in one chip: "All sent",
 * "3 not sent", "Offline · 3". Its accessible name always carries the
 * count ("Online, 0 not sent"), and the count is always in the page for the
 * offline suite, visible or not.
 */
export function SyncChip({
  connected,
  unsynced,
}: {
  connected: boolean;
  unsynced: number;
}) {
  const allSent = connected && unsynced === 0;
  const tone = allSent
    ? "border-positive-border bg-positive-subtle text-positive"
    : "border-warning-border bg-warning-subtle text-warning";
  const Icon = connected ? (allSent ? CloudCheck : CheckCircle) : CloudSlash;
  return (
    <button
      type="button"
      onClick={() => openView("#sync")}
      aria-label={`${connected ? "Online" : "Offline"}, ${unsynced} not sent`}
      className="flex min-h-12 items-center rounded-pill px-1"
    >
      <span
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold whitespace-nowrap",
          tone,
        )}
        data-numeric
      >
        {connected && !allSent ? (
          <span aria-hidden className="size-2 rounded-pill bg-warning-bright" />
        ) : (
          <Icon aria-hidden size={18} weight="regular" />
        )}
        <span data-testid="connection" className={connected ? "sr-only" : ""}>
          {connected ? "Online" : "Offline"}
        </span>
        {/* Offline, the bar has no room for words: "Offline · 3". */}
        {!connected && unsynced > 0 ? <span aria-hidden>·</span> : null}
        <span
          data-testid="unsynced-count"
          className={allSent || (!connected && unsynced === 0) ? "sr-only" : ""}
        >
          {unsynced}
        </span>
        {connected ? (allSent ? "All sent" : "not sent") : null}
      </span>
    </button>
  );
}

/** The bell (S-21): its count only when known — with no signal it is not. */
export function BellButton({ unread }: { unread: number | null }) {
  return (
    <button
      type="button"
      onClick={() => openView("#notifications")}
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex size-12 items-center justify-center rounded-pill text-ink hover:bg-surface-sunken"
      data-testid="bell"
    >
      <Bell aria-hidden size={24} weight="regular" />
      {unread ? (
        <span
          aria-hidden
          data-numeric
          className="absolute top-2 right-2 min-w-4 rounded-pill bg-critical px-1 text-center text-2xs leading-4 font-semibold text-ink-inverse"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}

const TAB_LABEL: Record<Tab, string> = {
  route: "Route",
  customers: "Customers",
  collections: "Collections",
  handover: "Cash",
  profile: "Profile",
};

const TAB_ICON: Record<
  Tab,
  ComponentType<{
    size?: number;
    weight?: "regular" | "fill";
    "aria-hidden"?: boolean;
  }>
> = {
  route: Path,
  customers: UsersThree,
  collections: Receipt,
  handover: Wallet,
  profile: UserCircle,
};

/**
 * The five tabs, as links — a tab is a place, not an action. The active one
 * sits in a teal-wash pill (Material 3). Collections carries the amber count
 * of what is still on the phone. Five is Material's most; at 360px each is
 * 72px wide, so the labels are the small size.
 */
export function BottomNav({
  active,
  unsynced,
}: {
  active: Tab;
  unsynced: number;
}) {
  return (
    <nav
      aria-label="Field app"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {(Object.keys(TAB_LABEL) as Tab[]).map((tab) => {
          const Icon = TAB_ICON[tab];
          const current = tab === active;
          return (
            <li key={tab}>
              <a
                href={`/route${TAB_HASH[tab]}`}
                onClick={(event) => {
                  event.preventDefault();
                  switchTab(tab);
                }}
                aria-current={current ? "page" : undefined}
                className="flex min-h-20 flex-col items-center justify-center gap-1 text-2xs font-medium text-ink-muted aria-[current=page]:font-semibold aria-[current=page]:text-ink"
              >
                <span
                  className={cn(
                    "relative flex h-8 w-14 items-center justify-center rounded-pill transition-colors",
                    current && "bg-accent-subtle text-accent",
                  )}
                >
                  <Icon
                    aria-hidden
                    size={24}
                    weight={current ? "fill" : "regular"}
                  />
                  {tab === "collections" && unsynced > 0 ? (
                    <span
                      aria-hidden
                      data-numeric
                      className="absolute -top-0.5 right-1.5 min-w-4 rounded-pill bg-warning-bright px-1 text-center text-2xs leading-4 font-semibold text-ink"
                    >
                      {unsynced > 99 ? "99+" : unsynced}
                    </span>
                  ) : null}
                </span>
                {TAB_LABEL[tab]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A Material banner under the app bar: something the Junior should know on
 * every screen until it stops being true — an expired sign-in, a full phone,
 * an old route. `action` is its one text button.
 */
export function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: "critical" | "warning" | "neutral";
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-2 rounded-surface border px-4 py-3",
        tone === "critical" &&
          "border-critical-border bg-critical-subtle text-critical",
        tone === "warning" &&
          "border-warning-border bg-warning-subtle text-warning",
        tone === "neutral" && "border-border bg-surface-sunken text-ink-muted",
      )}
    >
      <p className="flex items-start gap-3 text-sm leading-5 font-medium">
        <span aria-hidden className="mt-px shrink-0">
          {icon}
        </span>
        <span className="text-ink">{children}</span>
      </p>
      {action ? <div className="flex justify-end">{action}</div> : null}
    </div>
  );
}

/**
 * A snackbar over the bottom navigation: the "Saved on phone" receipt after a
 * door. It stays until the Junior moves on or dismisses it — a Junior looking
 * away must still find it.
 */
export function Snackbar({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4 pb-[env(safe-area-inset-bottom)]">
      <div
        role="status"
        className="pointer-events-auto mx-auto flex max-w-md animate-in items-center gap-3 rounded-surface bg-ink py-1 pr-1 pl-4 text-ink-inverse shadow-overlay"
      >
        <CheckCircle aria-hidden size={20} weight="fill" className="shrink-0" />
        <p className="min-w-0 flex-1 py-2 text-sm font-medium" data-numeric>
          {children}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex size-11 shrink-0 items-center justify-center rounded-pill hover:bg-ink-inverse/10"
        >
          <X aria-hidden size={18} weight="regular" />
        </button>
      </div>
    </div>
  );
}

/** A labelled group on a screen: small overline, then its content. */
export function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2
          className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase"
          data-numeric
        >
          {title}
        </h2>
        {aside ? <span className="text-xs text-ink-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * What the shell gives every screen: the app bar's standing actions (the sync
 * chip and the bell) and the banners that hold on every screen.
 */
export const FieldChrome = createContext<{
  actions: ReactNode;
  banners: ReactNode;
}>({ actions: null, banners: null });

/**
 * One field screen: the top app bar, the banners, the content, and — on a
 * screen with one job — a sticky action bar above the gesture area. Tabs get
 * room for the bottom navigation, which the shell draws.
 */
export function FieldPage({
  title,
  subtitle,
  back = false,
  actions,
  footer,
  testId,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  /**
   * Replaces the standing actions (the chip and the bell) when given; `false`
   * leaves the bar with none.
   */
  actions?: ReactNode;
  /** The sticky bottom action bar. */
  footer?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const chrome = use(FieldChrome);
  return (
    <>
      <TopAppBar
        title={title}
        subtitle={subtitle}
        back={back}
        actions={actions ?? chrome.actions}
      />
      <main
        className={cn(
          "mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 pt-4",
          footer ? (back ? "pb-0" : "pb-20") : back ? "pb-6" : "pb-32",
        )}
        data-testid={testId}
      >
        {chrome.banners}
        {children}
        {footer ? (
          <div
            className={cn(
              "sticky z-10 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface-raised px-4 pt-3",
              back
                ? "bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                : "bottom-[calc(5rem+env(safe-area-inset-bottom))] pb-3",
            )}
          >
            {footer}
          </div>
        ) : null}
      </main>
    </>
  );
}

/** The white card every field screen is built from (16px radius, hairline). */
export const cardClass =
  "rounded-overlay border border-border bg-surface-raised shadow-raised";
