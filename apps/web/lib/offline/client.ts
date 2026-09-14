"use client";

import { collectionContract, type RouteView } from "@repo/contracts";

import { api } from "../api-client";
import { type FieldDb, openFieldDb } from "./db";
import {
  DRAIN_LOCK,
  drainOutbox,
  pruneSynced,
  resumeAfterSignIn,
  retryEntry,
  SYNC_TAG,
} from "./drain";
import { recordCollection, type RecordRequest, storeRoute } from "./outbox";

export const SW_URL = "/serwist/sw.js";
export const SW_SCOPE = "/route";
const PERIODIC_DRAIN_MS = 60_000;
const KEEP_SYNCED_MS = 24 * 60 * 60 * 1000;

let database: Promise<FieldDb> | null = null;

/** One open database per page. */
export function fieldDb(): Promise<FieldDb> {
  database ??= openFieldDb();
  return database;
}

/**
 * Registers the service worker for the Junior's pages only and asks the
 * browser to keep this origin's storage — without it, IndexedDB can be evicted
 * under pressure and a day's collections with it (offline-sync.md#risks).
 */
export async function registerFieldWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  await navigator.storage?.persist?.().catch(() => false);
}

/** Drain from the page, under the shared lock, then tidy old synced rows. */
export async function drainNow(
  options: { ignoreBackoff?: boolean } = {},
): Promise<void> {
  if (!navigator.onLine) return;
  const db = await fieldDb();
  const report = await drainOutbox(db, options);
  if (!report.ran && navigator.locks) {
    // Another drain holds the lock — one started a moment ago here, or the
    // service worker's. Wait for it to finish, so whoever refreshes the screen
    // after this call sees what it sent instead of a row stuck on "Syncing";
    // then drain once more for what it had already passed over (a "Retry").
    await navigator.locks.request(DRAIN_LOCK, async () => undefined);
    await drainOutbox(db, options);
  }
  await pruneSynced(db, KEEP_SYNCED_MS);
}

/**
 * Background Sync first: the browser runs the worker's drain when signal
 * returns, even with the app closed (US-052). Where it is missing, the page's
 * fallbacks below carry the load.
 */
async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // Not `navigator.serviceWorker.ready`: it matches the document's original
  // URL, and a Junior who signed in reached /route by client-side navigation
  // from /sign-in, outside the worker's scope — so it never resolves.
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!registration) return;
  const sync = (registration as ServiceWorkerRegistration & {
    sync?: { register(tag: string): Promise<void> };
  }).sync;
  await sync?.register(SYNC_TAG).catch(() => undefined);
}

/**
 * Fallbacks 2–4 (offline-sync.md#sync): drain on `online`, on returning to
 * the foreground, and every minute while open. Fallback 1 — drain on worker
 * start — lives in the worker. Returns a function removing the listeners.
 */
export function startDrainTriggers(
  onChange: () => void,
  onReachability: (reachable: boolean) => void = () => undefined,
): () => void {
  const run = (ignoreBackoff: boolean) => {
    void (async () => {
      // `navigator.onLine` says only that a network interface is up — true on
      // mobile data with no internet, which is common at a customer's door.
      // Whether Rasi answered is what the Junior needs to know.
      const refreshed = await refreshRoute();
      onReachability(refreshed !== "unreachable");
      await drainNow({ ignoreBackoff });
    })().finally(onChange);
  };
  // Something changed: send now. The timer respects the backoff.
  const onOnline = () => run(true);
  const onVisible = () => {
    if (document.visibilityState === "visible") run(true);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onChange);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => run(false), PERIODIC_DRAIN_MS);
  run(true);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onChange);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

/**
 * Record at the door: saved on the phone first, then — without waiting —
 * a sync is requested and, if there is signal, a drain started (US-050).
 */
export async function recordAtDoor(request: RecordRequest, onChange: () => void) {
  const db = await fieldDb();
  const entry = await recordCollection(db, request);
  onChange();
  void requestBackgroundSync();
  void drainNow().finally(onChange);
  return entry;
}

/**
 * Fetches today's route when there is signal and keeps it on the phone. With
 * no signal, or a failed fetch, the cached copy is used — offline is not an
 * error (S-01).
 */
export async function refreshRoute(): Promise<
  "refreshed" | "refused" | "unreachable"
> {
  if (!navigator.onLine) return "unreachable";
  try {
    const result = await api(collectionContract.getRoute, {});
    if (!result.ok) return "refused";
    const db = await fieldDb();
    await storeRoute(db, result.body as RouteView);
    return "refreshed";
  } catch {
    return "unreachable";
  }
}

/** S-03 "Send now": everything waiting is tried at once, backoff or not. */
export async function retryAll(): Promise<void> {
  await drainNow({ ignoreBackoff: true });
}

/** S-03 "Retry one": this entry is tried now; the others keep their backoff. */
export async function retryOne(idempotencyKey: string): Promise<void> {
  if (await retryEntry(await fieldDb(), idempotencyKey)) await drainNow();
}

/** After signing in again, collections paused by a `401` go back in the queue. */
export async function resumeQueue(): Promise<void> {
  const db = await fieldDb();
  if ((await resumeAfterSignIn(db)) > 0) void drainNow();
}
