"use client";

import { type Me, staffContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import { FormMessage, formatCurrency } from "@repo/ui";
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
import { CollectScreen, type RecordAtDoor } from "./collect-screen";
import { CorrectScreen } from "./correct-screen";
import { backToRoute, parseView, useView } from "./hash-view";
import { RouteScreen } from "./route-screen";
import { StatusBar } from "./status-bar";
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
 * The Junior's field app (S-01, S-02, S-03, S-06, S-21) on the offline engine. One page,
 * its views by hash ([hash-view](./hash-view.ts)), one persistent status
 * bar, no other chrome (navigation-ia.md).
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
        <div className="h-[calc(var(--control-height)+1rem)] border-b border-border bg-surface-raised" />
        <div
          className="mx-auto flex w-full max-w-md flex-col gap-[var(--stack-gap)] p-4"
          aria-hidden
        >
          <div className="h-7 w-40 animate-pulse rounded-control bg-surface-sunken" />
          <div className="h-4 w-56 animate-pulse rounded-control bg-surface-sunken" />
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="h-24 animate-pulse rounded-surface border border-border bg-surface-raised"
            />
          ))}
        </div>
      </div>
    );
  }
  if (session.state === "signed-out") {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <FormMessage tone="info">
          Sign in to see your route. Collections saved on this phone are kept
          and sent after you sign in.
        </FormMessage>
        <Link href="/sign-in" className="font-medium text-accent underline">
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

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <StatusBar
        connected={connected}
        unsynced={summary?.unsynced ?? 0}
        unread={connected ? unread : null}
      />
      <main className="mx-auto flex w-full max-w-md flex-col gap-[var(--stack-gap)] px-4 pt-5 pb-10">
        {summary?.pausedForSignIn && view.name !== "sync" ? (
          <FormMessage tone="critical">
            Your sign-in has expired.{" "}
            <Link href="/sign-in" className="font-medium underline">
              Sign in again
            </Link>{" "}
            — your saved collections are kept and will send.
          </FormMessage>
        ) : null}
        {summary?.blocked && view.name !== "sync" ? (
          <FormMessage tone="critical">
            This phone is full of unsent collections. Find signal and send them
            before recording more.
          </FormMessage>
        ) : summary?.warn && view.name !== "sync" ? (
          <FormMessage tone="critical">
            Many collections are waiting. Find signal to send them.
          </FormMessage>
        ) : null}
        {local?.stale ? (
          <FormMessage tone="info">
            This route is more than three days old. Connect to refresh it.
          </FormMessage>
        ) : null}

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
        ) : view.name === "handover" ? (
          <HandoverScreen
            connected={connected}
            unsent={summary?.unsynced ?? 0}
          />
        ) : view.name === "sync" ? (
          <SyncScreen
            entries={entries}
            summary={summary}
            lastSync={lastSync}
            businessDate={businessDate}
            connected={connected}
            sending={sending}
            signOutBlocked={signOutBlocked}
            onSendNow={() => void send(retryAll)}
            onRetry={(entry) => void send(() => retryOne(entry.idempotencyKey))}
            onRemoveRefused={async (entry) => {
              await clearRefused(await fieldDb(), entry.idempotencyKey);
              await reload();
            }}
            onSignOut={() => void signOut()}
          />
        ) : (
          <>
            {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
            <RouteScreen
              local={local}
              businessDate={businessDate}
              name={me.name}
              connected={connected}
              refreshing={refreshing}
              onRefresh={() => void refresh()}
            />
          </>
        )}
      </main>
    </div>
  );
}
