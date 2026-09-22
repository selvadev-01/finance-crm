"use client";

import {
  CloudArrowDown,
  CloudSlash,
  SignIn,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { type Me, staffContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import { buttonClass, formatCurrency } from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { authClient } from "../../lib/auth-client";
import {
  fieldDb,
  recordAtDoor,
  refreshRoute,
  registerFieldWorker,
  resumeQueue,
  retryAll,
  retryOne,
  startDrainTriggers,
} from "../../lib/offline/client";
import type { OutboxEntry } from "../../lib/offline/db";
import {
  canSignOut,
  clearDeviceData,
  clearRefused,
  lastSyncAt,
  listOutbox,
  type LocalRoute,
  OutboxFullError,
  type OutboxSummary,
  readRoute,
  summarise,
} from "../../lib/offline/outbox";
import {
  Banner,
  BellButton,
  BottomNav,
  FieldChrome,
  Snackbar,
  SyncChip,
} from "./app-chrome";
import { CollectScreen, type RecordAtDoor } from "./collect-screen";
import { CollectionsScreen } from "./collections-screen";
import { CorrectScreen } from "./correct-screen";
import { CustomerPortfolioScreen } from "./customer-portfolio-screen";
import { CustomersScreen } from "./customers-screen";
import { backToRoute, isTab, parseView, useView } from "./hash-view";
import { ProfileScreen } from "./profile-screen";
import { RouteScreen } from "./route-screen";
import { SyncScreen } from "./sync-screen";
import { HandoverScreen } from "./handover-screen";
import { NotificationsScreen } from "./notifications-screen";
import { useUnreadCount } from "../../lib/notifications/use-unread-count";

const ME_KEY = "me";

type Session =
  | { state: "loading" }
  | { state: "ready"; me: Me; fromCache: boolean }
  | { state: "signed-out" };

/**
 * The Junior's field app (J-01…J-08) on the offline engine: one page, its
 * views by hash ([hash-view](./hash-view.ts)), with a native app's chrome —
 * a top app bar carrying the sync chip and the bell on every screen, and a
 * bottom navigation bar on the four tabs (navigation-ia.md).
 *
 * Nothing here waits for the network to record: a collection is saved on the
 * phone, shown at once, and sent when there is signal. Who is signed in is kept
 * on the phone too, so losing signal never sends the Junior to sign-in; a
 * lapsed session asks them to sign in again and keeps every collection.
 */
export function FieldRoute() {
  const router = useRouter();
  const view = useView();
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [local, setLocal] = useState<LocalRoute | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [summary, setSummary] = useState<OutboxSummary | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  /** Whether Rasi last answered; `navigator.onLine` alone is not enough. */
  const [reachable, setReachable] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signOutBlocked, setSignOutBlocked] = useState(false);
  const businessDate = toBusinessDate(new Date());
  const connected = online && reachable;
  const unread = useUnreadCount(session.state === "ready" && connected);

  /**
   * Several reloads overlap around a save (the record, the drain after it, the
   * screen's own). A read started later sees the phone's store at least as new,
   * so only the latest-started read may set state; an older one finishing last
   * would flip a row back from "Sent to office".
   */
  const latestRead = useRef(0);
  const reload = useCallback(async () => {
    const read = ++latestRead.current;
    const db = await fieldDb();
    const [route, outbox, counts, synced] = await Promise.all([
      readRoute(db, businessDate),
      listOutbox(db),
      summarise(db),
      lastSyncAt(db),
    ]);
    if (read !== latestRead.current) return route;
    setLocal(route);
    setEntries(outbox);
    setSummary(counts);
    setLastSync(synced);
    setOnline(navigator.onLine);
    if (counts.unsynced === 0) setSignOutBlocked(false);
    return route;
  }, [businessDate]);

  useEffect(() => {
    let stop = () => undefined as void;
    let cancelled = false;
    // The connection indicator is right from the first paint, not after the
    // start-up requests settle — "is my day safe" must not wait on the network.
    const onConnection = () => setOnline(navigator.onLine);
    onConnection();
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    void (async () => {
      const db = await fieldDb();
      const cached = (await db.get("meta", ME_KEY))?.value as Me | undefined;
      let me: Me | null = cached ?? null;
      let fromCache = true;
      try {
        const result = await api(staffContract.me, {});
        if (result.ok) {
          me = result.body;
          fromCache = false;
          await db.put("meta", { key: ME_KEY, value: me });
          await resumeQueue();
        } else if (result.status === 401 || result.status === 403) {
          me = null;
        }
      } catch {
        // No signal: the cached identity stands.
        setReachable(false);
      }
      if (cancelled) return;
      setSession(
        me ? { state: "ready", me, fromCache } : { state: "signed-out" },
      );
      if (!me) return;
      await registerFieldWorker().catch(() => undefined);
      await reload();
      stop = startDrainTriggers(() => void reload(), setReachable);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
      stop();
    };
  }, [reload]);

  // A notice belongs to the moment it was raised; it does not follow the
  // Junior to the next customer.
  useEffect(() => {
    const onNavigate = () => {
      if (parseView(window.location.hash).name !== "route") setNotice(null);
    };
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);

  if (session.state === "loading") {
    // A skeleton in the route's shape, not a spinner (design-system.md).
    return (
      <div
        className="flex min-h-dvh flex-col bg-surface"
        role="status"
        aria-label="Loading your route"
      >
        <div className="h-16 border-b border-border bg-surface-raised" />
        <div
          className="mx-auto flex w-full max-w-md flex-col gap-3 p-4"
          aria-hidden
        >
          <div className="h-40 animate-pulse rounded-overlay border border-border bg-surface-raised" />
          <div className="h-14 animate-pulse rounded-pill bg-surface-sunken" />
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="h-20 animate-pulse rounded-overlay border border-border bg-surface-raised"
            />
          ))}
        </div>
        <div className="fixed inset-x-0 bottom-0 h-20 border-t border-border bg-surface-raised" />
      </div>
    );
  }
  if (session.state === "signed-out") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <span
          aria-hidden
          className="flex size-16 items-center justify-center rounded-overlay bg-accent text-2xl font-semibold text-accent-ink"
        >
          R
        </span>
        <h1 className="text-xl font-semibold text-ink">
          Sign in to see your route
        </h1>
        <p className="text-base text-ink-muted">
          Collections saved on this phone are kept and sent after you sign in.
        </p>
        <Link
          href="/sign-in"
          className={buttonClass(
            "primary",
            "h-14 w-full rounded-pill text-base font-semibold",
          )}
        >
          <SignIn aria-hidden size={20} weight="regular" />
          Sign in
        </Link>
      </main>
    );
  }

  const onRecord: RecordAtDoor = async ({
    account,
    customer,
    amount,
    note,
  }) => {
    try {
      await recordAtDoor(
        {
          accountLoanId: account.accountLoanId,
          amount,
          note,
          businessDate,
          customerName: customer.name,
          accountCode: account.accountCode,
        },
        () => void reload(),
      );
    } catch (error) {
      return error instanceof OutboxFullError
        ? error.message
        : "Could not save on this phone. Try again.";
    }
    const route = await reload();
    const stillDue = route?.route.customers
      .find((candidate) => candidate.customerId === customer.customerId)
      ?.accounts.some(
        (candidate) => route.rowState[candidate.accountLoanId] === "PENDING",
      );
    if (!stillDue) {
      // Back to the route after every customer (navigation-ia.md).
      backToRoute();
      setNotice(
        `Saved on phone: ${amount === "0" ? "no payment" : formatCurrency(amount)} from ${customer.name}.`,
      );
    }
    return null;
  };

  async function refresh() {
    setRefreshing(true);
    const result = await refreshRoute();
    setReachable(result !== "unreachable");
    await reload();
    setRefreshing(false);
  }

  async function send(run: () => Promise<void>) {
    setSending(true);
    await run();
    await reload();
    setSending(false);
  }

  async function signOut() {
    const db = await fieldDb();
    if (!(await canSignOut(db))) {
      setSignOutBlocked(true);
      return;
    }
    await authClient.signOut();
    // Refuses, keeping everything, if a collection was saved in the meantime;
    // it is sent after the next sign-in.
    await clearDeviceData(db);
    router.replace("/sign-in");
  }

  const me = session.me;
  const unsynced = summary?.unsynced ?? 0;

  // Held on every screen until they stop being true (offline-sync.md).
  const banners = (
    <>
      {summary?.pausedForSignIn ? (
        <Banner
          tone="critical"
          icon={<Warning size={20} weight="regular" />}
          action={
            <Link
              href="/sign-in"
              className={buttonClass(
                "ghost",
                "rounded-pill font-semibold text-critical hover:text-critical",
              )}
            >
              Sign in again
            </Link>
          }
        >
          Your sign-in has expired. Your saved collections are kept and will
          send.
        </Banner>
      ) : null}
      {summary?.blocked ? (
        <Banner tone="critical" icon={<Warning size={20} weight="regular" />}>
          This phone is full of unsent collections. Find signal and send them
          before recording more.
        </Banner>
      ) : summary?.warn ? (
        <Banner tone="critical" icon={<Warning size={20} weight="regular" />}>
          Many collections are waiting. Find signal to send them.
        </Banner>
      ) : null}
      {!connected &&
      view.name !== "sync" &&
      view.name !== "handover" &&
      view.name !== "notifications" &&
      view.name !== "correct" ? (
        // The screens that need signal say so in their own words.
        <Banner tone="neutral" icon={<CloudSlash size={20} weight="regular" />}>
          No signal. Collections save on this phone and send by themselves when
          signal returns.
        </Banner>
      ) : null}
      {local?.stale ? (
        <Banner
          tone="neutral"
          icon={<CloudArrowDown size={20} weight="regular" />}
        >
          This route is more than three days old. Connect to refresh it.
        </Banner>
      ) : null}
    </>
  );

  const chrome = {
    actions: (
      <>
        <SyncChip connected={connected} unsynced={unsynced} />
        <BellButton unread={connected ? unread : null} />
      </>
    ),
    banners,
  };

  return (
    <FieldChrome value={chrome}>
      <div className="flex min-h-dvh flex-col bg-surface">
        {view.name === "collect" ? (
          <CollectScreen
            key={view.customerId}
            customerId={view.customerId}
            local={local}
            onRecord={onRecord}
          />
        ) : view.name === "correct" ? (
          <CorrectScreen connected={connected} />
        ) : view.name === "notifications" ? (
          <NotificationsScreen connected={connected} />
        ) : view.name === "sync" ? (
          <SyncScreen
            entries={entries}
            lastSync={lastSync}
            businessDate={businessDate}
            connected={connected}
            sending={sending}
            onSendNow={() => void send(retryAll)}
            onRetry={(entry) => void send(() => retryOne(entry.idempotencyKey))}
            onRemoveRefused={async (entry) => {
              await clearRefused(await fieldDb(), entry.idempotencyKey);
              await reload();
            }}
          />
        ) : view.name === "customers" ? (
          <CustomersScreen
            lineId={local?.route.lineId ?? me.currentLineId}
            connected={connected}
          />
        ) : view.name === "customer" ? (
          <CustomerPortfolioScreen
            key={view.customerId}
            customerId={view.customerId}
            local={local}
            connected={connected}
            businessDate={businessDate}
          />
        ) : view.name === "collections" ? (
          <CollectionsScreen
            local={local}
            entries={entries}
            businessDate={businessDate}
            unsynced={unsynced}
            connected={connected}
          />
        ) : view.name === "handover" ? (
          <HandoverScreen connected={connected} unsent={unsynced} />
        ) : view.name === "profile" ? (
          <ProfileScreen
            me={me}
            local={local}
            connected={connected}
            unsynced={unsynced}
            lastSync={lastSync}
            signOutBlocked={signOutBlocked}
            onSignOut={() => void signOut()}
          />
        ) : (
          <RouteScreen
            local={local}
            businessDate={businessDate}
            connected={connected}
            unsynced={unsynced}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        )}
        {isTab(view) ? (
          <BottomNav active={view.name} unsynced={unsynced} />
        ) : null}
        {notice && view.name === "route" ? (
          <Snackbar onDismiss={() => setNotice(null)}>{notice}</Snackbar>
        ) : null}
      </div>
    </FieldChrome>
  );
}
