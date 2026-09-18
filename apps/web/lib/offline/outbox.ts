import type { RouteView } from "@repo/contracts";

import { subtractMoney, toPaise } from "../money";

import type { CachedRoute, FieldDb, OutboxEntry } from "./db";
import { LAST_SYNC_KEY } from "./drain";

/** offline-sync.md#queue-limits */
export const WARN_AT = 100;
export const BLOCK_AT = 300;

/** Entries that are the Junior's responsibility until the office has them. */
const UNSYNCED: OutboxEntry["status"][] = [
  "QUEUED",
  "SYNCING",
  "PAUSED_AUTH",
  "FAILED",
];

export class OutboxFullError extends Error {
  constructor(readonly unsynced: number) {
    super(
      `${unsynced} collections are waiting to be sent. Find signal and sync before recording more.`,
    );
  }
}

export interface RecordRequest {
  accountLoanId: string;
  /** A decimal string; never a number (BR-11). */
  amount: string;
  note?: string;
  businessDate: string;
  customerName: string;
  accountCode: string;
}

/**
 * Records a collection **on the device** and returns — no network, ever
 * (US-050). The idempotency key is generated here, at record time, and stored
 * with the entry so every retry sends the same key (BR-13, US-053).
 */
export async function recordCollection(
  db: FieldDb,
  request: RecordRequest,
  now: Date = new Date(),
): Promise<OutboxEntry> {
  const tx = db.transaction("outbox", "readwrite");
  const byStatus = tx.store.index("byStatus");
  let unsynced = 0;
  for (const status of UNSYNCED) unsynced += await byStatus.count(status);
  if (unsynced >= BLOCK_AT) {
    // Aborting rejects `tx.done`; nothing was written, so that is expected.
    tx.done.catch(() => undefined);
    tx.abort();
    throw new OutboxFullError(unsynced);
  }
  const idempotencyKey = crypto.randomUUID();
  const capturedAt = now.toISOString();
  const entry: OutboxEntry = {
    idempotencyKey,
    payload: {
      idempotencyKey,
      accountLoanId: request.accountLoanId,
      amount: request.amount,
      capturedAt,
      ...(request.note ? { note: request.note } : {}),
    },
    capturedAt,
    businessDate: request.businessDate,
    customerName: request.customerName,
    accountCode: request.accountCode,
    status: "QUEUED",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    result: null,
    syncedAt: null,
  };
  await tx.store.add(entry);
  await tx.done;
  return entry;
}

/** Everything in the outbox, oldest first. */
export async function listOutbox(db: FieldDb): Promise<OutboxEntry[]> {
  return db.getAllFromIndex("outbox", "byCapturedAt");
}

export interface OutboxSummary {
  unsynced: number;
  failed: number;
  pausedForSignIn: boolean;
  /** `WARN_AT` reached: tell the Junior to find connectivity. */
  warn: boolean;
  /** `BLOCK_AT` reached: new entries are refused. */
  blocked: boolean;
}

export async function summarise(db: FieldDb): Promise<OutboxSummary> {
  const entries = await listOutbox(db);
  const unsynced = entries.filter((entry) =>
    UNSYNCED.includes(entry.status),
  ).length;
  return {
    unsynced,
    failed: entries.filter((entry) => entry.status === "FAILED").length,
    pausedForSignIn: entries.some((entry) => entry.status === "PAUSED_AUTH"),
    warn: unsynced >= WARN_AT,
    blocked: unsynced >= BLOCK_AT,
  };
}

/**
 * What the phone tells the office about its queue (US-060): how many
 * collections are still unsent and when the oldest was taken, so a Senior
 * closing the day knows whose phone may still hold that day's money.
 */
export async function queueReport(
  db: FieldDb,
): Promise<{ unsentCount: number; oldestUnsentAt?: string }> {
  const unsent = (await listOutbox(db)).filter((entry) =>
    UNSYNCED.includes(entry.status),
  );
  return unsent.length === 0
    ? { unsentCount: 0 }
    : { unsentCount: unsent.length, oldestUnsentAt: unsent[0]!.capturedAt };
}

/** Sign-out is blocked while anything is still on the phone (US-002). */
export async function canSignOut(db: FieldDb): Promise<boolean> {
  return (await summarise(db)).unsynced === 0;
}

// ---------------------------------------------------------------- route

/** offline-sync.md#the-requirement: the route stays usable for 72 hours. */
export const ROUTE_TTL_MS = 72 * 60 * 60 * 1000;

export async function storeRoute(
  db: FieldDb,
  route: RouteView,
  now: Date = new Date(),
): Promise<void> {
  const cached: CachedRoute = {
    businessDate: route.businessDate,
    server: route,
    fetchedAt: now.getTime(),
  };
  await db.put("route", cached);
}

export interface LocalRoute {
  route: RouteView;
  fetchedAt: number;
  /** Older than 72 hours: show a stale-data warning (S-01). */
  stale: boolean;
  /** Balances include collections still on the phone. */
  optimistic: boolean;
  /** S-01's per-row state, by `accountLoanId`. */
  rowState: Record<string, RowState>;
}

/**
 * S-01: `PENDING` not yet collected today; `SAVED` on the phone (including
 * waiting for sign-in); `SYNCING`; `SYNCED`. A refused entry leaves the row
 * pending — the office does not have that money.
 */
export type RowState = "PENDING" | "SAVED" | "SYNCING" | "SYNCED";

const ROW_STATE: Record<Exclude<OutboxEntry["status"], "FAILED">, RowState> = {
  QUEUED: "SAVED",
  PAUSED_AUTH: "SAVED",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
};

/**
 * The route for `businessDate` as the Junior should see it: the server's
 * figures with every collection **whose key the server's figures do not
 * include** applied on top — outstanding decremented and the row shown as
 * collected (offline-sync.md#balances-update-locally). Refused (FAILED) entries
 * are not applied, because the office does not have that money.
 */
export async function readRoute(
  db: FieldDb,
  businessDate: string,
  now: Date = new Date(),
): Promise<LocalRoute | null> {
  const cached = await db.get("route", businessDate);
  if (!cached) return null;
  const entries = await listOutbox(db);
  const route: RouteView = structuredClone(cached.server);
  const rowState: Record<string, RowState> = {};
  for (const customer of route.customers) {
    for (const account of customer.accounts) {
      rowState[account.accountLoanId] = account.collectedToday
        ? "SYNCED"
        : "PENDING";
    }
  }
  let applied = 0;
  for (const entry of entries) {
    if (entry.businessDate !== businessDate || entry.status === "FAILED")
      continue;
    // Oldest first, so the latest entry for an account sets its row.
    if (entry.payload.accountLoanId in rowState) {
      rowState[entry.payload.accountLoanId] = ROW_STATE[entry.status];
    }
    for (const customer of route.customers) {
      const account = customer.accounts.find(
        (candidate) => candidate.accountLoanId === entry.payload.accountLoanId,
      );
      // Reconciled by key, not by timestamps: a refresh that lands while the
      // entry is still SYNCING already includes it if the server committed.
      if (!account || account.includedKeys.includes(entry.idempotencyKey))
        continue;
      applied += 1;
      account.outstandingAmount = subtractMoney(
        account.outstandingAmount,
        entry.payload.amount,
      );
      account.collectedToday = {
        amount: entry.payload.amount,
        classification: classifyLocally(
          entry.payload.amount,
          account.expectedAmount,
        ),
      };
    }
  }
  return {
    route,
    fetchedAt: cached.fetchedAt,
    stale: now.getTime() - cached.fetchedAt > ROUTE_TTL_MS,
    optimistic: applied > 0,
    rowState,
  };
}

/** When the server last acknowledged a collection from this phone, if ever. */
export async function lastSyncAt(db: FieldDb): Promise<string | null> {
  const meta = await db.get("meta", LAST_SYNC_KEY);
  return typeof meta?.value === "string" ? meta.value : null;
}

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * S-02's check before saving on the phone: a plain rupee amount, not more
 * than the (optimistic) outstanding. The server checks again on sync.
 * Returns what is wrong, or `null`; the screen words and formats it.
 */
export function amountProblem(
  amount: string,
  outstanding: string,
): "NOT_AN_AMOUNT" | "EXCEEDS_OUTSTANDING" | null {
  if (!AMOUNT.test(amount)) return "NOT_AN_AMOUNT";
  if (toPaise(amount) > toPaise(outstanding)) return "EXCEEDS_OUTSTANDING";
  return null;
}

/**
 * The Junior acknowledges a collection the office refused (US-054): the money
 * is in their hand and goes to the office by hand. Only a FAILED entry can be
 * cleared — nothing still on its way is ever removed. Returns whether it was.
 */
export async function clearRefused(
  db: FieldDb,
  idempotencyKey: string,
): Promise<boolean> {
  const tx = db.transaction("outbox", "readwrite");
  const entry = await tx.store.get(idempotencyKey);
  const refused = entry?.status === "FAILED";
  if (refused) await tx.store.delete(idempotencyKey);
  await tx.done;
  return refused;
}

/**
 * Local data dies with the session (offline-sync.md#status-visibility): the
 * route (names, addresses, mobiles), who was signed in, and the day's sent
 * entries are removed. In one transaction with the check, so a collection
 * saved in between is never swept away; returns `false` and clears nothing
 * if anything is still on the phone.
 */
export async function clearDeviceData(db: FieldDb): Promise<boolean> {
  const tx = db.transaction(["outbox", "route", "meta"], "readwrite");
  const outbox = tx.objectStore("outbox");
  let unsynced = 0;
  for (const status of UNSYNCED)
    unsynced += await outbox.index("byStatus").count(status);
  if (unsynced > 0) {
    tx.done.catch(() => undefined);
    tx.abort();
    return false;
  }
  await Promise.all([
    outbox.clear(),
    tx.objectStore("route").clear(),
    tx.objectStore("meta").clear(),
  ]);
  await tx.done;
  return true;
}

// ------------------------------------------------------------ money (paise)

// The field screens import it from here; the arithmetic lives in lib/money.
export { subtractMoney };

/** BR-08 on the device, for display only; the server's classification is stored. */
export function classifyLocally(
  amount: string,
  expected: string,
): "CORRECT" | "LOW" | "EXTRA" | "NO_PAYMENT" {
  const paid = toPaise(amount);
  const due = toPaise(expected);
  if (paid === 0n) return "NO_PAYMENT";
  if (paid === due) return "CORRECT";
  return paid < due ? "LOW" : "EXTRA";
}
