# M14 — Jobs and Scheduling

**Purpose:** everything that happens without a user asking for it.

**Source:** implied by §13 (automatic completion), §12 (notifications), and the reconciliation the ledger requires.

---

## Scope

**In:** pg-boss queues and schedules, job handlers, retry policy, dead-letter handling, worker process.

**Out:** the business logic each job invokes — owned by the module it belongs to. This module owns _when and how reliably_, never _what_.

---

## Owns no entities

pg-boss manages its own schema in the same PostgreSQL database.

> Using Postgres for queueing rather than Redis means one datastore, one backup, one point-in-time recovery, and — crucially — **a job can be enqueued in the same transaction as the change that triggers it**. A notification job enqueued transactionally cannot fire for a collection that rolled back. That property is worth more here than raw throughput, and at ~1,500 collections a day throughput is not the constraint.

---

## Scheduled jobs

All times `Asia/Kolkata`. Cron expressions live in configuration, not code (M15).

| Job                              | Schedule            | Module | Purpose                                                           |
| -------------------------------- | ------------------- | ------ | ----------------------------------------------------------------- |
| `detect-missed-collections`      | Hourly, 18:00–22:00 | M07    | Mark `MISSED` slots for closed lines, alert Seniors               |
| `flag-overdue-accounts`          | Daily 00:30         | M05    | Set `isOverdue` past target completion                            |
| `reconcile-balances`             | Daily 01:00         | M09    | Rebuild ledger balances, verify account caches, alert on mismatch |
| `dispatch-notifications`         | Continuous worker   | M10    | Drain the notification outbox                                     |
| `dispatch-emails`                | Every minute        | M10    | Send queued email over SMTP                                       |
| `retry-failed-push`              | Every 5 min         | M10    | Backoff retries                                                   |
| `purge-idempotency-keys`         | Daily 02:00         | M07    | Remove keys past 90 days                                          |
| `deactivate-stale-subscriptions` | Weekly              | M10    | Clear subscriptions unseen for 90 days                            |
| `archive-audit-partitions`       | Monthly             | M13    | Roll yearly partitions                                            |

### Missed detection runs per line, after that line closes

Not on a fixed global schedule.

> A Junior collecting at 6pm has not missed anything at noon. Running detection at a fixed hour would raise false alerts for every line still working, and alert fatigue destroys the value of the alerts that matter. The hourly window exists to catch lines that close late, checking only lines whose `day_close` is `CLOSED`.

---

## Job design rules

**Every handler is idempotent.** A job that runs twice must not corrupt data. This is non-negotiable — pg-boss guarantees at-least-once delivery, not exactly-once.

**No long-running work in a handler.** Anything heavy is split into per-line or per-account jobs, so one slow line cannot block the queue.

**Overlap prevention.** Scheduled jobs use pg-boss singleton keys so a slow run cannot overlap its own next trigger.

**Explicit timezone.** Every schedule declares `Asia/Kolkata`. None relies on server local time.

**Errors are loud.** An unhandled exception in a scheduled job is otherwise invisible — every failure logs structured context and alerts after a retry budget is exhausted.

**Retry policy:** exponential backoff, 5 attempts, then dead-letter. Dead-lettered jobs alert Admin and are inspectable and replayable.

---

## Worker process

The worker is **the same NestJS application booted in `--worker` mode**, not a separate app.

> It deploys as its own process — so a heavy reconciliation cannot slow the API, and each can scale independently — while sharing the codebase, the domain logic and the Prisma client. A third application would duplicate all three and drift. For a modular monolith this is the right seam: separate at runtime, unified at build.

The API process enqueues; the worker process consumes. In development both run in one process for convenience, configurable by env.

---

## Transactional enqueue

Jobs triggered by a state change are enqueued **inside the same database transaction**.

```
BEGIN
  insert collection
  insert ledger entries
  insert notification
  enqueue push-dispatch job
COMMIT
```

If the transaction rolls back, the job never existed. This removes the entire class of bugs where a queued job references a row that was never committed.

---

## Operations

| Operation                        | Actor       |
| -------------------------------- | ----------- |
| View job status and history      | Admin+      |
| View dead-letter queue           | Admin+      |
| Replay a dead-lettered job       | Super Admin |
| Trigger a scheduled job manually | Super Admin |

---

## As built

In `apps/api/src/jobs/`. Status is in the [backlog](../../06-delivery/backlog.md). **Not yet run against the database** — see below.

- **Schema.** pg-boss 12.32.0 keeps its tables in the `pgboss` schema. The `rasi` role cannot create a schema, so a superuser creates it once: `CREATE SCHEMA pgboss AUTHORIZATION rasi;` (decided 2026-09-14). `JobQueue` passes `createSchema: false`: otherwise pg-boss runs `CREATE SCHEMA IF NOT EXISTS` on install, and PostgreSQL refuses that to `rasi` with "permission denied for database" even when the schema exists. pg-boss creates its own tables inside the schema on the first worker start. Prisma never sees those tables, so migration drift checks stay empty.
- **Worker mode.** `WORKER_ENABLED` is read only in `JobsModule`. When true, the process starts pg-boss and registers queues, schedules and consumers; the HTTP server still listens (the development convenience ADR-0003 allows). Off by default; `createTestApp` forces it off, so no test suite starts a queue whatever the developer's `.env` holds.
- **A worker that cannot start does not take the API down** (decided 2026-09-15). The first real run failed on the missing `pgboss` schema and the whole API stopped with it, leaving nowhere to record a collection. The failure is now caught and logged at error level — naming that jobs, notifications and email are not being sent — and the HTTP server keeps serving. Queued work waits for a process that starts successfully. `test/worker-start.e2e-spec.ts` holds both halves: the app serves with a failing worker and logs the cause, and no worker starts by default.
- **Queues.** Each scheduled job has a trigger queue and a per-organization queue, both `stately` (one queued, one active), with `retryLimit: 5`, `retryBackoff: true` and a `.dead` dead-letter queue whose handler logs at error level. The trigger fans out one job per organization, singleton-keyed by it.
- **Schedules** come from `JOBS_RECONCILE_CRON` (01:00), `JOBS_OVERDUE_CRON` (00:30) and `JOBS_PURGE_KEYS_CRON` (02:00), evaluated in `Asia/Kolkata`; `dispatch-notifications` runs every minute and drains the M10 outbox through `PushDispatchService`; `dispatch-emails` runs every minute and sends `email_outbox` through `EmailDispatchService`. M15 settings are not built, so these are environment variables.
- **Handlers** live in their modules and take a `SystemContext` — one organization and the run id — instead of a `RequestContext`; every query filters by `organizationId`. Audit entries use `AuditWriter.recordSystem` with a null actor. `reconcile-balances` → `ReconciliationService` (M09), `flag-overdue-accounts` → `OverdueService` (M05), `purge-idempotency-keys` → `IdempotencyPurgeService` (M07). Each is proven idempotent in Tier 1 by running it twice.
- **Transactional enqueue.** `JobQueue.enqueue(tx, name, data)` passes pg-boss a `db` executor that runs its insert through the Prisma transaction. Nothing enqueues yet: M10 writes its outbox rows in the event's transaction and drains them on a schedule instead, which keeps the same guarantee.
- **`detect-missed-collections` is not scheduled**: missed slots are marked when a line closes (M08).

**Not built:** the job status and dead-letter screens, replay and manual trigger, the dead-letter Admin alert, `deactivate-stale-subscriptions`, `archive-audit-partitions`.

## Risks

| Risk                                          | Mitigation                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Silent job failure                            | Structured logging, alerting after retry budget, dead-letter visibility             |
| Overlapping runs                              | pg-boss singleton keys                                                              |
| Non-idempotent handler corrupts data on retry | Idempotency required by convention and covered by tests that run each handler twice |
| Queue backs up during peak collection hours   | Worker scales independently; notification dispatch is the only high-volume queue    |
| Clock or timezone drift on the worker host    | Schedules declare timezone explicitly; health check reports server time             |
