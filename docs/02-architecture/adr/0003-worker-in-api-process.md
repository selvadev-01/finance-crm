# ADR-0003 — The worker is the API application in `--worker` mode

**Status:** Accepted · 2026-09-12

## Context

Rasi needs background work: notification dispatch, missed-collection detection, nightly reconciliation, maintenance ([M14](../../01-product/modules/M14-jobs.md)). Some of it is heavy — reconciliation reads the whole ledger — and must not compete with collection writes during the working day.

The options are one process doing both, a separate worker application, or the same application booted differently.

## Decision

**One codebase, two runtime modes.** `apps/api` boots as an HTTP server or, with `WORKER_ENABLED=true`, as a job consumer. They deploy as separate containers from the same image.

In development both run in one process for convenience.

## Consequences

**Good**

- Job handlers call the same module services as HTTP handlers. No duplicated business logic, no drift between two implementations of the same rule
- One Prisma client, one domain package, one set of tests
- Heavy jobs cannot slow the API — separate processes, separate connection pools
- Each scales independently: more workers during a backlog, more API instances for load
- One image to build and version, so the two cannot deploy out of sync with each other's expectations

**Bad**

- The worker image carries HTTP dependencies it never uses. A negligible cost in a container
- `WORKER_ENABLED` is a mode flag, and mode flags invite conditional complexity if allowed to spread. It is read once at bootstrap and nowhere else

**Neutral**

- Both processes connect to the same database, so connection pool sizing must account for both

## Alternatives considered

**A single process serving HTTP and consuming jobs.** Simplest, and rejected because the nightly reconciliation would contend with the API for event-loop time and connections. It is also the harder configuration to scale out of later, since splitting then means extracting code rather than changing a flag.

**A separate `apps/worker` application.** Rejected as the more expensive form of the same thing. It would need its own copy of the module wiring, its own Prisma setup and its own dependency list — three things that drift from the API's. The failure mode is subtle: a business rule changes in the API and the worker keeps applying the old one.

**An external scheduler (cron, a managed service) calling HTTP endpoints.** Rejected. It gives up transactional enqueue ([ADR-0004](0004-pg-boss-over-redis.md)), makes retries the caller's problem, and turns internal jobs into authenticated public endpoints.
