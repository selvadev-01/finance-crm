/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import {
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
  type SerwistGlobalConfig,
} from "serwist";

import { openFieldDb } from "../lib/offline/db";
import { installPushHandlers } from "../lib/notifications/push-worker";
import { drainOutbox, SYNC_TAG } from "../lib/offline/drain";

/**
 * The Junior's service worker (offline-sync.md), registered with scope `/route`
 * so the admin console carries none of this.
 *
 * - **Caching:** Serwist precaches the build and applies its recommended
 *   runtime strategies, so a route loaded once works with no signal.
 * - **Sync:** Background Sync drains the outbox even with the app closed;
 *   the worker also drains when it starts and when a page asks. The same
 *   engine, the same idempotency keys, the same Web Lock as the page.
 * - **Push:** shows M10 notifications; a tap opens the field app's
 *   notifications view — the deep links point at console pages (US-071).
 * - **Updates wait for the next launch:** no `skipWaiting`, no
 *   `clientsClaim`, so an outbox never changes implementation mid-route. Opening
 *   the database runs its versioned migrations before any drain.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: [
    // The API is never cached here. The route and identity live in IndexedDB,
    // where the engine applies queued collections to them; a second, stale
    // copy in the Cache API would disagree with it. Network-only also fails at
    // once with no signal, instead of waiting out a network-first timeout
    // before the page falls back to the phone's copy.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

async function drain(): Promise<void> {
  const db = await openFieldDb();
  try {
    await drainOutbox(db);
  } finally {
    db.close();
  }
}

interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

self.addEventListener("sync", (event) => {
  const sync = event as SyncEvent;
  if (sync.tag === SYNC_TAG) sync.waitUntil(drain());
});

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "drain") {
    event.waitUntil(drain());
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(drain());
});

installPushHandlers(self, () => "/route#notifications");

// Fallback 1 (offline-sync.md#sync): drain whenever the worker starts.
void drain();

serwist.addEventListeners();
