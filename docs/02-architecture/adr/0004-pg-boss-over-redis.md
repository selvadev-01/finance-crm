# ADR-0004 — pg-boss on Postgres, no Redis

**Status:** Accepted · 2026-09-12

## Context

Rasi needs a job queue for notification dispatch, scheduled detection jobs and nightly reconciliation. The default reach in a Node ecosystem is BullMQ on Redis.

Volume is modest: roughly 1,500 collections a day, each potentially producing a notification fan-out across a handful of devices. Peak is a few hundred jobs in a busy quarter-hour.

## Decision

**pg-boss, using the application's own PostgreSQL database.** No Redis in v1.

## Consequences

**Good**

- **Transactional enqueue.** A job is enqueued inside the transaction that triggers it. A notification job cannot fire for a collection that rolled back, and a committed collection cannot be missing its job. This is the deciding property
- One datastore: one backup, one point-in-time recovery, one connection story, one thing to monitor and operate
- Jobs are durable by default — they survive a restart with no persistence configuration
- Queue state is inspectable with SQL, which matters at 2am when something has stalled

**Bad**

- Lower throughput ceiling than Redis. pg-boss handles thousands per second; Rasi needs a few thousand per day, so the ceiling is roughly three orders of magnitude above requirement
- Queue load competes with application queries for database connections. Mitigated by separate pools per process ([ADR-0003](0003-worker-in-api-process.md))
- Fewer ecosystem tools than BullMQ — no equivalent of Bull Board, so job visibility is built into the Admin screens

**Neutral**

- If throughput ever becomes the constraint, moving to a broker is a contained change behind the job interface. That is a real possibility at a much larger scale, and not this year's problem

## Alternatives considered

**BullMQ on Redis.** The conventional choice, rejected because it buys throughput Rasi does not need at the cost of the guarantee Rasi does need. Getting transactional enqueue with an external broker requires an outbox table plus a relay process — which is a Postgres-backed queue with extra moving parts. It also adds a second datastore to back up, restore and monitor, for a business running on one VPS.

**In-process scheduling with `@nestjs/schedule`.** Rejected. No durability, no retries, and no coordination across processes — two API instances would each run every scheduled job.

**A managed queue (SQS, Cloud Tasks).** Rejected. External dependency, network failure modes, and no transactional enqueue, for a system deliberately kept to one external integration.
