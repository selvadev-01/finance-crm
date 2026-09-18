import type { CollectionView } from "@repo/contracts";

import type { FieldDb, OutboxEntry } from "./db";

/** The lock both the page and the service worker take, so only one drains. */
export const DRAIN_LOCK = "rasi-outbox-drain";
/** The Background Sync tag the page registers after every enqueue. */
export const SYNC_TAG = "rasi-outbox";
/** `meta` key: when the server last acknowledged a collection (S-03). */
export const LAST_SYNC_KEY = "lastSyncAt";

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;

/** offline-sync.md#sync — 2s, 4s, 8s … capped at five minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_CAP_MS,
  );
}

export interface DrainOptions {
  fetch?: typeof fetch;
  /** Origin to post to; `""` for same-origin (page and service worker). */
  baseUrl?: string;
  now?: () => number;
  /** Web Locks; absent in environments without it (tests pass a stub). */
  locks?: LockManager | null;
  /**
   * How long one request may take before it counts as a network failure.
   * A weak connection hangs rather than fails; without a limit, one stuck
   * request would hold the drain lock and every later drain would skip.
   */
  requestTimeoutMs?: number;
  /**
   * Retry entries now even inside their backoff. For the moments something
   * changed — signal came back, the app returned to the foreground — so a
   * backoff set while there was no network does not delay the queue once there
   * is. The periodic timer leaves this off, so a failing server is not hammered.
   */
  ignoreBackoff?: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;

export interface DrainReport {
  /** `false` when another context held the lock and this one did nothing. */
  ran: boolean;
  synced: number;
  failed: number;
  retrying: number;
  pausedForSignIn: boolean;
}

/**
 * Sends queued collections to the server (offline-sync.md#sync).
 *
 * - **Oldest first**, by `capturedAt` — and when an entry for an account is
 *   waiting to retry, later entries for that account wait too, so collections
 *   against one account apply in the order they were taken.
 * - **Failures are isolated:** a refusal (4xx) marks that entry FAILED and the
 *   drain moves on; a network error or 5xx backs off and moves on.
 * - **`401` pauses everything and discards nothing.** The rest of the queue is
 *   marked PAUSED_AUTH until the Junior signs in again.
 * - **Every attempt sends the entry's stored idempotency key**, so an ambiguous
 *   outcome — the server committed, the response was lost — is answered by the
 *   server as a replay (`200`), never a duplicate (BR-13).
 *
 * Only one context drains at a time (Web Locks, `ifAvailable`): a page and its
 * service worker draining together would still be safe, but would double the
 * requests.
 */
export async function drainOutbox(
  db: FieldDb,
  options: DrainOptions = {},
): Promise<DrainReport> {
  const locks =
    options.locks === undefined
      ? // `navigator` is a Navigator in a page, a WorkerNavigator in the worker.
        ((globalThis as { navigator?: { locks?: LockManager } }).navigator
          ?.locks ?? null)
      : options.locks;
  const report: DrainReport = {
    ran: false,
    synced: 0,
    failed: 0,
    retrying: 0,
    pausedForSignIn: false,
  };
  // A collection saved while this drain holds the lock would otherwise wait for
  // the next trigger — its own drain finds the lock taken and skips. So before
  // releasing it, look again and send whatever arrived meanwhile. Only entries
  // not seen yet: a failed entry is not retried in the same drain.
  const run = async () => {
    const seen = new Set<string>();
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const arrived = await drainOnce(db, options, report, seen, pass === 0);
      if (report.pausedForSignIn || (pass > 0 && !arrived)) return;
    }
  };
  if (!locks) {
    await run();
    return report;
  }
  await locks.request(DRAIN_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock) await run();
  });
  return report;
}

/** Passes per drain: the first, plus rounds for entries saved meanwhile. */
const MAX_PASSES = 10;

/**
 * One pass over the outbox. Returns whether it found an unsent entry it had
 * not seen in an earlier pass of the same drain.
 */
async function drainOnce(
  db: FieldDb,
  options: DrainOptions,
  report: DrainReport,
  seen: Set<string>,
  firstPass: boolean,
): Promise<boolean> {
  report.ran = true;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const baseUrl = options.baseUrl ?? "";
  let arrived = false;

  // A previous drain killed mid-flight (tab closed, worker stopped) left
  // entries SYNCING; they are simply queued again — the key makes it safe.
  const entries = (await db.getAllFromIndex("outbox", "byCapturedAt")).map(
    (entry): OutboxEntry =>
      entry.status === "SYNCING" ? { ...entry, status: "QUEUED" } : entry,
  );
  const blockedAccounts = new Set<string>();

  for (const entry of entries) {
    const account = entry.payload.accountLoanId;
    if (entry.status === "SYNCED" || entry.status === "FAILED") continue;
    if (seen.has(entry.idempotencyKey)) {
      // Already tried in this drain; it still holds back its account's later entries.
      blockedAccounts.add(account);
      continue;
    }
    seen.add(entry.idempotencyKey);
    if (!firstPass) arrived = true;
    if (blockedAccounts.has(account)) continue;
    if (!options.ignoreBackoff && entry.nextAttemptAt > now()) {
      blockedAccounts.add(account);
      report.retrying += 1;
      continue;
    }

    await db.put("outbox", { ...entry, status: "SYNCING" });
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/api/collections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.payload),
        signal: AbortSignal.timeout(
          options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      await retryLater(db, entry, now(), null, "NETWORK", String(error));
      blockedAccounts.add(account);
      report.retrying += 1;
      continue;
    }

    if (response.status === 201 || response.status === 200) {
      const body = (await response.json()) as CollectionView;
      const syncedAt = new Date(now()).toISOString();
      await db.put("outbox", {
        ...entry,
        status: "SYNCED",
        attempts: entry.attempts + 1,
        result: body,
        lastError: null,
        syncedAt,
      });
      await db.put("meta", { key: LAST_SYNC_KEY, value: syncedAt });
      report.synced += 1;
      continue;
    }

    const error = await readError(response);
    if (response.status === 401) {
      // Stop here and keep everything: this entry and all the rest wait.
      await pauseForSignIn(db);
      report.pausedForSignIn = true;
      return false;
    }
    if (response.status >= 400 && response.status < 500) {
      await db.put("outbox", {
        ...entry,
        status: "FAILED",
        attempts: entry.attempts + 1,
        lastError: {
          status: response.status,
          code: error.code,
          message: error.message,
        },
      });
      report.failed += 1;
      continue;
    }
    await retryLater(
      db,
      entry,
      now(),
      response.status,
      error.code,
      error.message,
    );
    blockedAccounts.add(account);
    report.retrying += 1;
  }
  return arrived;
}

async function retryLater(
  db: FieldDb,
  entry: OutboxEntry,
  now: number,
  status: number | null,
  code: string | null,
  message: string,
): Promise<void> {
  const attempts = entry.attempts + 1;
  await db.put("outbox", {
    ...entry,
    status: "QUEUED",
    attempts,
    nextAttemptAt: now + backoffMs(attempts),
    lastError: { status, code, message },
  });
}

async function pauseForSignIn(db: FieldDb): Promise<void> {
  const tx = db.transaction("outbox", "readwrite");
  for (const entry of await tx.store.getAll()) {
    if (entry.status === "QUEUED" || entry.status === "SYNCING") {
      await tx.store.put({ ...entry, status: "PAUSED_AUTH" });
    }
  }
  await tx.done;
}

/** After a new sign-in: paused entries go back in the queue, keys unchanged. */
export async function resumeAfterSignIn(db: FieldDb): Promise<number> {
  const tx = db.transaction("outbox", "readwrite");
  let resumed = 0;
  for (const entry of await tx.store.getAll()) {
    if (entry.status === "PAUSED_AUTH") {
      await tx.store.put({ ...entry, status: "QUEUED", nextAttemptAt: 0 });
      resumed += 1;
    }
  }
  await tx.done;
  return resumed;
}

/**
 * "Retry one" (S-03): an entry waiting out its backoff becomes due now.
 * Only a queued entry — a refused one cannot be retried into success.
 */
export async function retryEntry(
  db: FieldDb,
  idempotencyKey: string,
): Promise<boolean> {
  const tx = db.transaction("outbox", "readwrite");
  const entry = await tx.store.get(idempotencyKey);
  const queued = entry?.status === "QUEUED";
  if (entry && queued) await tx.store.put({ ...entry, nextAttemptAt: 0 });
  await tx.done;
  return queued;
}

/** Synced entries are kept for the day's view, then pruned. */
export async function pruneSynced(
  db: FieldDb,
  olderThanMs: number,
  now: number = Date.now(),
): Promise<number> {
  const tx = db.transaction("outbox", "readwrite");
  let removed = 0;
  for (const entry of await tx.store.getAll()) {
    if (
      entry.status === "SYNCED" &&
      entry.syncedAt !== null &&
      now - Date.parse(entry.syncedAt) > olderThanMs
    ) {
      await tx.store.delete(entry.idempotencyKey);
      removed += 1;
    }
  }
  await tx.done;
  return removed;
}

async function readError(
  response: Response,
): Promise<{ code: string | null; message: string }> {
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    return {
      code: body.code ?? null,
      message: body.message ?? `The server answered ${response.status}`,
    };
  } catch {
    return { code: null, message: `The server answered ${response.status}` };
  }
}
