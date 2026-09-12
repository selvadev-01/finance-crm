# ADR-0008 — Offline-first PWA with an IndexedDB outbox

**Status:** Accepted · 2026-09-12

## Context

Juniors collect cash on foot, on mid-range Android phones, in areas where signal is unreliable and sometimes absent. Each visits dozens of customers a day and must record every collection.

If recording requires connectivity, a Junior in a dead zone falls back to paper — which is the system Rasi exists to replace. The failure is not degraded service; it is no service, at the exact moment the money changes hands.

## Decision

**A full offline-first PWA for the Junior's route**, designed in from day one.

- The route is cached in IndexedDB with a 72-hour TTL
- Collections write to an **IndexedDB outbox** and return in under 100 ms, never awaiting the network
- Each carries a **UUID v4 idempotency key generated at record time**, before any network attempt
- The Background Sync API drains the queue, with four fallback triggers for browsers lacking it
- The server enforces uniqueness on the key; a replay returns the original response with `200`
- Three sync states are always visible, with a persistent unsynced count

Native app packaging is not used; the PWA installs to the home screen.

## Consequences

**Good**

- The Junior is never blocked. Recording always succeeds locally
- Duplicates are structurally impossible, not merely unlikely — the unique constraint is the guarantee
- A day's collections survive app closure, device restart and session lapse
- One codebase and one deployment serve both the admin console and the field app
- No app store, so updates reach devices immediately — which matters for a business that cannot chase 40 field phones

**Bad**

- **The single largest source of complexity in v1.** Outbox, sync orchestration, conflict handling, storage limits and three-state UI are all genuine work
- Requires server-side idempotency infrastructure that would otherwise be unnecessary
- Hardest area to test — needs Playwright with network manipulation, browser restarts and quota exhaustion
- A closed day is not final until every device syncs, which forced the reopen rule (BR-16a)
- Storage quota is a real limit, needing warning and hard-cap thresholds

**Neutral**

- Append-only collections ([ADR-0006](0006-append-only-ledger.md)) make conflict resolution tractable: there is no field-level merge problem because nothing is edited

## Alternatives considered

**Online-only, mobile-optimised.** Far simpler and rejected on the core use case. A Junior who cannot record at the door either skips the entry or writes it on paper and enters it later from memory — reintroducing exactly the transcription errors and unverifiable figures that motivated the project.

**Cached reads, online writes.** Rejected as solving the easier half. Seeing the route offline is useful; the collection itself is the thing that must not be lost.

**A native Android application.** Rejected. Better offline primitives, at the cost of a second codebase, a second skill set, store review latency and an update path that depends on 40 field staff tapping "update". The web platform's offline capabilities are sufficient here.

**Retrofitting offline after v1.** Rejected outright. Idempotency keys, append-only records and the reopen rule all shape the schema and the API. Adding them later would mean re-migrating collection data and rewriting the day-close model.
