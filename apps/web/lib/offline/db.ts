import type { CollectionView, RouteView } from "@repo/contracts";
import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  openDB,
  type StoreNames,
} from "idb";

/**
 * The device's store for the Junior's day (offline-sync.md#local-storage).
 *
 * Shared by the page and the service worker — the same schema, the same
 * upgrade path. **Versioned:** a new service worker migrates the outbox in
 * `upgrade` before any drain touches it, so queued collections survive an app
 * update (offline-sync.md#service-worker-scope).
 *
 * Framework-free on purpose: no React, no Next — it runs in a worker.
 */
export const DB_NAME = "rasi-field";

/** Where an entry is in its life, shown to the Junior as three states (US-054). */
export type OutboxStatus =
  /** Saved on the phone, not yet sent. "Saved on phone". */
  | "QUEUED"
  /** In flight. "Syncing". */
  | "SYNCING"
  /** Sent and acknowledged by the server. "Sent to office". */
  | "SYNCED"
  /**
   * Refused for a reason retrying cannot fix (4xx). Stays, blocking sign-out,
   * until the Junior confirms handing the money to the office (S-03).
   */
  | "FAILED"
  /** Waiting for a new sign-in; never discarded (offline-sync.md#sync). */
  | "PAUSED_AUTH";

export interface CollectionPayload {
  idempotencyKey: string;
  accountLoanId: string;
  amount: string;
  capturedAt: string;
  note?: string;
}

export interface OutboxEntry {
  /** The idempotency key — generated when the collection is recorded (BR-13). */
  idempotencyKey: string;
  payload: CollectionPayload;
  /** For drain order and display. */
  capturedAt: string;
  /** The route's business date the entry was recorded against. */
  businessDate: string;
  customerName: string;
  accountCode: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which a retry is not attempted (exponential backoff). */
  nextAttemptAt: number;
  lastError: {
    status: number | null;
    code: string | null;
    message: string;
  } | null;
  /** The server's answer once synced. */
  result: CollectionView | null;
  syncedAt: string | null;
}

export interface CachedRoute {
  businessDate: string;
  /** The route as the server last sent it — never mutated. */
  server: RouteView;
  /** When it was fetched, epoch ms (72-hour TTL). */
  fetchedAt: number;
}

export interface Meta {
  key: string;
  value: unknown;
}

export interface FieldSchema extends DBSchema {
  route: { key: string; value: CachedRoute };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { byCapturedAt: string; byStatus: OutboxStatus };
  };
  meta: { key: string; value: Meta };
}

export type FieldDb = IDBPDatabase<FieldSchema>;

/**
 * One step from version `n` to `n + 1`, run inside the upgrade transaction. A
 * step may rewrite outbox entries through `transaction` — and must only await
 * IndexedDB requests, or the transaction commits under it. It never deletes
 * the outbox store: queued collections are money a Junior has taken.
 */
export type Migration = (
  db: IDBPDatabase<FieldSchema>,
  transaction: IDBPTransaction<
    FieldSchema,
    ArrayLike<StoreNames<FieldSchema>>,
    "versionchange"
  >,
) => void | Promise<void>;

/**
 * Every schema version, in order: the database's version is the length of this
 * list. To change the schema, **append** a step — never edit one that has
 * shipped, since a phone may still be on any earlier version.
 */
export const MIGRATIONS: readonly Migration[] = [
  // 1 — the route cache, the outbox and device metadata.
  (db) => {
    db.createObjectStore("route", { keyPath: "businessDate" });
    const outbox = db.createObjectStore("outbox", {
      keyPath: "idempotencyKey",
    });
    outbox.createIndex("byCapturedAt", "capturedAt");
    outbox.createIndex("byStatus", "status");
    db.createObjectStore("meta", { keyPath: "key" });
  },
];

export const DB_VERSION = MIGRATIONS.length;

export interface OpenOptions {
  /** Tests only: a longer list stands in for a future app version. */
  migrations?: readonly Migration[];
  /**
   * A newer version (a new service worker, another tab) wants to upgrade.
   * The connection is closed first — an open one would block the upgrade —
   * and this lets its holder drop any cached handle.
   */
  onClosedForUpgrade?: () => void;
}

/**
 * Opens the field database, running each missing step in one upgrade
 * transaction. **A step that throws aborts the whole upgrade**: the database
 * stays at its old version with every queued entry in it, and the open
 * rejects with that step's error — a broken app update cannot empty the
 * outbox (offline-sync.md#service-worker-scope).
 */
export async function openFieldDb(
  name: string = DB_NAME,
  options: OpenOptions = {},
): Promise<FieldDb> {
  const migrations = options.migrations ?? MIGRATIONS;
  let failure: unknown = null;
  const opening = openDB<FieldSchema>(name, migrations.length, {
    async upgrade(db, oldVersion, _newVersion, transaction) {
      try {
        for (let version = oldVersion; version < migrations.length; version++) {
          await migrations[version]!(db, transaction);
        }
      } catch (error) {
        failure = error;
        // The abort is the point; its rejection of `done` is expected.
        transaction.done.catch(() => undefined);
        transaction.abort();
      }
    },
  });
  let db: FieldDb;
  try {
    db = await opening;
  } catch (error) {
    throw failure ?? error;
  }
  db.addEventListener("versionchange", () => {
    db.close();
    options.onClosedForUpgrade?.();
  });
  return db;
}
