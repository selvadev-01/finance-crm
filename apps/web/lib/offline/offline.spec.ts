import type { RouteView } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { type FieldDb, openFieldDb } from "./db";
import { backoffMs, drainOutbox, pruneSynced, resumeAfterSignIn, retryEntry } from "./drain";
import {
  amountProblem,
  BLOCK_AT,
  lastSyncAt,
  canSignOut,
  clearDeviceData,
  clearRefused,
  listOutbox,
  OutboxFullError,
  readRoute,
  recordCollection,
  storeRoute,
  summarise,
  WARN_AT,
} from "./outbox";

const TODAY = "2026-09-14";

function route(): RouteView {
  return {
    businessDate: TODAY,
    day: { kind: "WORKING" },
    lineId: "line-1",
    customers: [
      {
        customerId: "cus-1",
        customerCode: "CUS-00001",
        name: "Lakshmi",
        address: "12 Market Road",
        mobile: "+919800000001",
        accounts: [
          { accountLoanId: "acc-1", accountCode: "ACC-2026-00001", expectedAmount: "100.00", outstandingAmount: "1000.00", dailyAmount: "100.00", daysRemaining: 90, collectedToday: null, includedKeys: [] },
          { accountLoanId: "acc-2", accountCode: "ACC-2026-00002", expectedAmount: "150.00", outstandingAmount: "80.00", dailyAmount: "150.00", daysRemaining: 90, collectedToday: null, includedKeys: [] },
        ],
      },
    ],
  };
}

const record = (db: FieldDb, accountLoanId: string, amount: string, at?: Date) =>
  recordCollection(
    db,
    { accountLoanId, amount, businessDate: TODAY, customerName: "Lakshmi", accountCode: accountLoanId },
    at,
  );

/** A scripted server: answers each POST in turn, recording what it was sent. */
function server(...answers: (number | "network" | ((body: { idempotencyKey: string }) => Response))[]) {
  const sent: { idempotencyKey: string; accountLoanId: string; amount: string }[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    const answer = answers.shift() ?? 201;
    if (answer === "network") throw new TypeError("Failed to fetch");
    if (typeof answer === "function") return answer(body);
    const payload =
      answer < 300
        ? { ...body, id: `col-${sent.length}`, account: {} }
        : { code: answer === 401 ? "UNAUTHENTICATED" : "ACCOUNT_NOT_ACTIVE", message: "refused" };
    return new Response(JSON.stringify(payload), { status: answer });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

describe("offline outbox (offline-sync.md, BR-13)", () => {
  let db: FieldDb;

  beforeEach(async () => {
    db = await openFieldDb(`test-${randomUUID()}`);
  });

  describe("US-050 record with no network", () => {
    it("saves on the device with an idempotency key generated at record time, never touching the network", async () => {
      const entry = await record(db, "acc-1", "100");
      expect(entry.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry.payload.idempotencyKey).toBe(entry.idempotencyKey);
      expect(entry.status).toBe("QUEUED");
      expect(await listOutbox(db)).toHaveLength(1);
    });

    it("saves in well under 100 ms", async () => {
      const started = performance.now();
      for (let i = 0; i < 20; i += 1) await record(db, "acc-1", "100");
      expect((performance.now() - started) / 20).toBeLessThan(100);
    });
  });

  describe("US-053 replay creates no duplicates", () => {
    it("Scenario: key generated at record time — every retry after an ambiguous outcome sends the same key", async () => {
      const entry = await record(db, "acc-1", "100");
      // 1st: the server committed but the response was lost; 2nd: 500; 3rd: replay 200.
      const { fetch, sent } = server("network", 500, 200);
      let clock = 0;
      await drainOutbox(db, { fetch, locks: null, now: () => clock });
      clock += backoffMs(1);
      await drainOutbox(db, { fetch, locks: null, now: () => clock });
      clock += backoffMs(2);
      await drainOutbox(db, { fetch, locks: null, now: () => clock });

      expect(sent.map((body) => body.idempotencyKey)).toEqual([
        entry.idempotencyKey,
        entry.idempotencyKey,
        entry.idempotencyKey,
      ]);
      const [stored] = await listOutbox(db);
      expect(stored).toMatchObject({ status: "SYNCED", attempts: 3 });
    });
  });

  describe("US-052 sync", () => {
    it("drains oldest first, and one refusal does not block the others", async () => {
      await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      await record(db, "acc-2", "80", new Date("2026-09-14T04:05:00Z"));
      await record(db, "acc-1", "100", new Date("2026-09-14T04:10:00Z"));
      const { fetch, sent } = server(201, 422, 201);

      const report = await drainOutbox(db, { fetch, locks: null });

      expect(sent.map((body) => body.accountLoanId)).toEqual(["acc-1", "acc-2", "acc-1"]);
      expect(report).toMatchObject({ synced: 2, failed: 1 });
      const statuses = (await listOutbox(db)).map((entry) => entry.status);
      expect(statuses).toEqual(["SYNCED", "FAILED", "SYNCED"]);
    });

    it("an account waiting to retry holds back its later collections, so they apply in the order taken; other accounts carry on", async () => {
      await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      await record(db, "acc-1", "100", new Date("2026-09-14T04:10:00Z"));
      await record(db, "acc-2", "80", new Date("2026-09-14T04:20:00Z"));
      const { fetch, sent } = server("network", 201);

      await drainOutbox(db, { fetch, locks: null, now: () => 0 });

      expect(sent.map((body) => body.accountLoanId)).toEqual(["acc-1", "acc-2"]);
      const byAccount = (await listOutbox(db)).map((entry) => [entry.payload.accountLoanId, entry.status]);
      expect(byAccount).toEqual([["acc-1", "QUEUED"], ["acc-1", "QUEUED"], ["acc-2", "SYNCED"]]);
    });

    it("a request that hangs counts as a network failure after the timeout, so the drain finishes and the lock is released", async () => {
      const entry = await record(db, "acc-1", "100");
      const hanging = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof globalThis.fetch;
      const report = await drainOutbox(db, { fetch: hanging, locks: null, requestTimeoutMs: 50 });
      expect(report.retrying).toBe(1);
      const [stored] = await listOutbox(db);
      expect(stored).toMatchObject({ idempotencyKey: entry.idempotencyKey, status: "QUEUED", attempts: 1 });
    });

    it("signal returning retries at once, even inside a backoff set while there was none", async () => {
      await record(db, "acc-1", "100");
      await drainOutbox(db, { fetch: server("network").fetch, locks: null, now: () => 0 });
      const { fetch, sent } = server(201);

      await drainOutbox(db, { fetch, locks: null, now: () => 1 });
      expect(sent).toHaveLength(0);

      await drainOutbox(db, { fetch, locks: null, now: () => 1, ignoreBackoff: true });
      expect(sent).toHaveLength(1);
      expect((await listOutbox(db))[0]!.status).toBe("SYNCED");
    });

    it("retry one makes a backed-off entry due now; a refused entry cannot be retried; the last sync time is kept", async () => {
      const waiting = await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      const refused = await record(db, "acc-2", "80", new Date("2026-09-14T04:05:00Z"));
      const at = Date.parse("2026-09-14T05:00:00Z");
      await drainOutbox(db, { fetch: server("network", 422).fetch, locks: null, now: () => at });
      expect(await lastSyncAt(db)).toBeNull();

      expect(await retryEntry(db, refused.idempotencyKey)).toBe(false);
      expect(await retryEntry(db, waiting.idempotencyKey)).toBe(true);
      const again = server(201);
      await drainOutbox(db, { fetch: again.fetch, locks: null, now: () => at + 1 });
      expect(again.sent.map((body) => body.idempotencyKey)).toEqual([waiting.idempotencyKey]);
      expect(await lastSyncAt(db)).toBe(new Date(at + 1).toISOString());
    });

    it("a collection saved while a drain is sending is sent by that drain before it lets go of the lock", async () => {
      const first = await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      let second: string | null = null;
      const sent: string[] = [];
      const fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        sent.push(body.idempotencyKey);
        // The Junior confirms the customer's second account mid-request; that
        // record's own drain would find the lock taken and skip.
        if (!second) second = (await record(db, "acc-2", "150", new Date("2026-09-14T04:00:05Z"))).idempotencyKey;
        return new Response(JSON.stringify({ ...body, id: `col-${sent.length}`, account: {} }), { status: 201 });
      }) as typeof globalThis.fetch;

      const report = await drainOutbox(db, { fetch, locks: null });

      expect(sent).toEqual([first.idempotencyKey, second]);
      expect(report.synced).toBe(2);
      expect((await listOutbox(db)).map((entry) => entry.status)).toEqual(["SYNCED", "SYNCED"]);
    });

    it("an entry that fails is not tried again within the same drain, even ignoring backoff", async () => {
      await record(db, "acc-1", "100");
      const flaky = server("network", "network", "network");
      await drainOutbox(db, { fetch: flaky.fetch, locks: null, ignoreBackoff: true });
      expect(flaky.sent).toHaveLength(1);
    });

    it("backs off 2s, 4s, 8s … and caps at five minutes", () => {
      expect([1, 2, 3, 4].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
      expect(backoffMs(20)).toBe(300_000);
    });

    it("an entry left SYNCING by a drain that was killed is sent again with its key", async () => {
      const entry = await record(db, "acc-1", "100");
      await db.put("outbox", { ...entry, status: "SYNCING" });
      const { fetch, sent } = server(200);
      await drainOutbox(db, { fetch, locks: null });
      expect(sent[0]!.idempotencyKey).toBe(entry.idempotencyKey);
      expect((await listOutbox(db))[0]!.status).toBe("SYNCED");
    });

    it("only one context drains at a time", async () => {
      await record(db, "acc-1", "100");
      const held: string[] = [];
      const locks = {
        request: async (_name: string, _options: object, callback: (lock: object | null) => Promise<void>) => {
          const available = held.length === 0;
          if (available) held.push("drain");
          try {
            await callback(available ? {} : null);
          } finally {
            if (available) held.pop();
          }
        },
      } as unknown as LockManager;
      const { fetch, sent } = server(201);
      const holding = locks.request("x", {}, async () => {
        const report = await drainOutbox(db, { fetch, locks });
        expect(report.ran).toBe(false);
      });
      await holding;
      expect(sent).toHaveLength(0);
    });
  });

  describe("401 mid-sync", () => {
    it("pauses the queue and keeps every entry; after sign-in they resume with their keys", async () => {
      const first = await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      await record(db, "acc-2", "80", new Date("2026-09-14T04:05:00Z"));
      const expired = server(401);
      const report = await drainOutbox(db, { fetch: expired.fetch, locks: null });

      expect(report.pausedForSignIn).toBe(true);
      expect(expired.sent).toHaveLength(1);
      expect((await listOutbox(db)).map((entry) => entry.status)).toEqual(["PAUSED_AUTH", "PAUSED_AUTH"]);
      expect(await canSignOut(db)).toBe(false);

      expect(await resumeAfterSignIn(db)).toBe(2);
      const again = server(201, 201);
      await drainOutbox(db, { fetch: again.fetch, locks: null });
      expect(again.sent[0]!.idempotencyKey).toBe(first.idempotencyKey);
      expect(await canSignOut(db)).toBe(true);
    });
  });

  describe("S-02 amount check on the phone", () => {
    it("accepts rupees with up to two decimals up to the outstanding, and refuses anything else", () => {
      expect(amountProblem("100", "1000.00")).toBeNull();
      expect(amountProblem("80.00", "80.00")).toBeNull();
      expect(amountProblem("0", "80.00")).toBeNull();
      expect(amountProblem("80.01", "80.00")).toBe("EXCEEDS_OUTSTANDING");
      for (const bad of ["", "1e3", "-5", "10.005", "1,000", " 100"]) {
        expect(amountProblem(bad, "5000.00")).toBe("NOT_AN_AMOUNT");
      }
    });
  });

  describe("queue limits", () => {
    it(`warns at ${WARN_AT} unsynced and refuses new entries at ${BLOCK_AT}`, async () => {
      for (let i = 0; i < WARN_AT; i += 1) await record(db, "acc-1", "1");
      expect(await summarise(db)).toMatchObject({ unsynced: WARN_AT, warn: true, blocked: false });
      for (let i = WARN_AT; i < BLOCK_AT; i += 1) await record(db, "acc-1", "1");
      await expect(record(db, "acc-1", "1")).rejects.toBeInstanceOf(OutboxFullError);
      expect((await listOutbox(db)).length).toBe(BLOCK_AT);
    });
  });

  describe("US-051 route available offline, balances updated locally", () => {
    it("applies unsynced collections to the cached route, marked optimistic; a refused one is not applied", async () => {
      await storeRoute(db, route(), new Date("2026-09-14T03:00:00Z"));
      await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      const local = await readRoute(db, TODAY, new Date("2026-09-14T05:00:00Z"));

      const [first, second] = local!.route.customers[0]!.accounts;
      expect(local!.optimistic).toBe(true);
      expect(first).toMatchObject({ outstandingAmount: "900.00", collectedToday: { amount: "100", classification: "CORRECT" } });
      expect(second!.outstandingAmount).toBe("80.00");

      const { fetch } = server(422);
      await drainOutbox(db, { fetch, locks: null });
      const afterRefusal = await readRoute(db, TODAY);
      expect(afterRefusal!.route.customers[0]!.accounts[0]!.outstandingAmount).toBe("1000.00");
    });

    it("once synced and the route is fetched again, the server's figure is not reduced twice", async () => {
      await storeRoute(db, route(), new Date("2026-09-14T03:00:00Z"));
      const entry = await record(db, "acc-1", "100");
      await drainOutbox(db, { fetch: server(201).fetch, locks: null, now: () => Date.parse("2026-09-14T04:00:00Z") });
      // Before the refresh, the synced entry is still applied to the old figures.
      expect((await readRoute(db, TODAY))!.route.customers[0]!.accounts[0]!.outstandingAmount).toBe("900.00");

      const refreshed = route();
      refreshed.customers[0]!.accounts[0]!.outstandingAmount = "900.00";
      refreshed.customers[0]!.accounts[0]!.includedKeys = [entry.idempotencyKey];
      await storeRoute(db, refreshed, new Date("2026-09-14T04:30:00Z"));
      const local = await readRoute(db, TODAY);
      expect(local!.route.customers[0]!.accounts[0]!.outstandingAmount).toBe("900.00");
      expect(local!.optimistic).toBe(false);
    });

    it("a refresh that lands while the entry is still syncing, after the server committed it, does not reduce the balance twice", async () => {
      const entry = await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      let refreshDuringSync: Promise<void> | null = null;
      const committedButUnanswered = server(() => {
        // The server has committed; the route fetched now already includes it.
        const refreshed = route();
        refreshed.customers[0]!.accounts[0]!.outstandingAmount = "900.00";
        refreshed.customers[0]!.accounts[0]!.includedKeys = [entry.idempotencyKey];
        refreshDuringSync = storeRoute(db, refreshed, new Date("2026-09-14T05:00:00Z"));
        throw new TypeError("Failed to fetch");
      });
      await drainOutbox(db, { fetch: committedButUnanswered.fetch, locks: null });
      await refreshDuringSync;

      const local = await readRoute(db, TODAY);
      expect((await listOutbox(db))[0]!.status).toBe("QUEUED");
      expect(local!.route.customers[0]!.accounts[0]!.outstandingAmount).toBe("900.00");
      expect(local!.optimistic).toBe(false);
    });

    it("a refused collection can be removed once acknowledged; nothing still on its way can be", async () => {
      const refused = await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      const waiting = await record(db, "acc-2", "80", new Date("2026-09-14T04:05:00Z"));
      await drainOutbox(db, { fetch: server(422, "network").fetch, locks: null });
      expect(await canSignOut(db)).toBe(false);

      expect(await clearRefused(db, waiting.idempotencyKey)).toBe(false);
      expect(await clearRefused(db, refused.idempotencyKey)).toBe(true);
      expect((await listOutbox(db)).map((entry) => entry.idempotencyKey)).toEqual([waiting.idempotencyKey]);
    });

    it("signing out clears the route, identity and sent entries — and clears nothing while a collection is unsent", async () => {
      await storeRoute(db, route());
      await db.put("meta", { key: "me", value: { name: "Junior" } });
      await record(db, "acc-1", "100");
      expect(await clearDeviceData(db)).toBe(false);
      expect(await db.count("route")).toBe(1);

      await drainOutbox(db, { fetch: server(201).fetch, locks: null });
      expect(await clearDeviceData(db)).toBe(true);
      expect([await db.count("route"), await db.count("meta"), await db.count("outbox")]).toEqual([0, 0, 0]);
    });

    it("gives each row its S-01 state: pending, saved on phone, syncing, synced — and a refused entry leaves it pending", async () => {
      const served = route();
      served.customers[0]!.accounts.push({ ...served.customers[0]!.accounts[0]!, accountLoanId: "acc-3", accountCode: "ACC-3" });
      served.customers[0]!.accounts[1]!.collectedToday = { amount: "80.00", classification: "CORRECT" };
      await storeRoute(db, served);
      await record(db, "acc-3", "100", new Date("2026-09-14T04:00:00Z"));
      await drainOutbox(db, { fetch: server(422).fetch, locks: null });
      await record(db, "acc-1", "100", new Date("2026-09-14T04:10:00Z"));

      expect((await readRoute(db, TODAY))!.rowState).toEqual({ "acc-1": "SAVED", "acc-2": "SYNCED", "acc-3": "PENDING" });
    });

    it("is stale after 72 hours", async () => {
      await storeRoute(db, route(), new Date("2026-09-14T03:00:00Z"));
      expect((await readRoute(db, TODAY, new Date("2026-09-17T02:59:00Z")))!.stale).toBe(false);
      expect((await readRoute(db, TODAY, new Date("2026-09-17T03:01:00Z")))!.stale).toBe(true);
    });

    it("prunes synced entries after a day, never unsynced ones", async () => {
      await record(db, "acc-1", "100", new Date("2026-09-14T04:00:00Z"));
      await record(db, "acc-2", "80", new Date("2026-09-14T04:05:00Z"));
      await drainOutbox(db, { fetch: server(201, 500).fetch, locks: null, now: () => 0 });
      expect(await pruneSynced(db, 24 * 3600_000, 2 * 24 * 3600_000)).toBe(1);
      expect((await listOutbox(db)).map((entry) => entry.payload.accountLoanId)).toEqual(["acc-2"]);
    });
  });
});
