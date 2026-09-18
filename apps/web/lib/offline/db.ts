import type { CollectionView, RouteView } from "@repo/contracts";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

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
export const DB_VERSION = 1;

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

export function openFieldDb(name: string = DB_NAME): Promise<FieldDb> {
  return openDB<FieldSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Each step migrates one version forward; never drop the outbox.
      if (oldVersion < 1) {
        db.createObjectStore("route", { keyPath: "businessDate" });
        const outbox = db.createObjectStore("outbox", {
          keyPath: "idempotencyKey",
        });
        outbox.createIndex("byCapturedAt", "capturedAt");
        outbox.createIndex("byStatus", "status");
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
}
