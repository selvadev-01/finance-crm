# Background Jobs

pg-boss on the application's own PostgreSQL database. Decision in [ADR-0004](adr/0004-pg-boss-over-redis.md). Module spec: [M14](../01-product/modules/M14-jobs.md).

---

## Why Postgres is the queue

| Property | Consequence |
| --- | --- |
| **Transactional enqueue** | A job can be enqueued in the same transaction as the change that triggers it |
| One datastore | One backup, one PITR, one connection story, one thing to operate |
| Durable by default | Jobs survive a restart without configuring persistence |
| Throughput ceiling | Thousands/sec — far above ~1,500 collections a day |

> The transactional property is the deciding one. A notification job enqueued transactionally cannot fire for a collection that rolled back, and a committed collection cannot be missing its job. With a separate broker, that guarantee needs an outbox table and a relay — which is a Postgres queue with extra steps.

---

## Queues

| Queue | Trigger | Concurrency |
| --- | --- | --- |
| `push-dispatch` | Notification created | 10 |
| `push-retry` | Backoff schedule | 5 |
| `schedule-regenerate` | Collection confirmed | 5 |
| `missed-detection` | Scheduled, per line | 2 |
| `reconciliation` | Scheduled, nightly | 1 |
| `maintenance` | Scheduled | 1 |

`reconciliation` runs single-threaded on purpose — it reads the whole ledger, and concurrent runs would contend for the same rows to no benefit.

---

## Schedules

All `Asia/Kolkata`, declared explicitly. Cron expressions live in settings (M15), so changing a schedule is not a deployment.

| Job | Cron | Purpose |
| --- | --- | --- |
| `detect-missed-collections` | `0 18-22 * * *` | Mark `MISSED` for lines that have closed |
| `flag-overdue-accounts` | `30 0 * * *` | Set `isOverdue` past target |
| `reconcile-balances` | `0 1 * * *` | Verify caches against the ledger |
| `purge-idempotency-keys` | `0 2 * * *` | Remove keys past 90 days |
| `deactivate-stale-subscriptions` | `0 3 * * 0` | Weekly hygiene |
| `archive-audit-partitions` | `0 4 1 * *` | Monthly partition roll |

### Missed detection is hourly, not daily

It runs each hour of the evening and processes **only lines whose `day_close` is `CLOSED`**.

> A Junior collecting at 6pm has not missed anything at noon. A single fixed-time run would either fire before late lines finish — raising false alerts across the business — or run so late that a Senior learns of a missed visit the following morning. Per-line, post-close detection is the only version that produces true alerts.

---

## Handler rules

**Every handler is idempotent.** pg-boss guarantees at-least-once, not exactly-once. Each handler is tested by running it twice and asserting identical state.

**Singleton keys prevent overlap.** A scheduled job uses `singletonKey` so a slow run cannot overlap its own next trigger.

**Handlers are short.** Anything long is fanned out — `reconcile-balances` enqueues per-line jobs rather than iterating everything inline, so one slow line cannot stall the queue.

**Failures are loud.** An unhandled exception in a scheduled job is otherwise invisible. Every failure logs structured context, and dead-lettering alerts an Admin.

**No business logic in handlers.** A handler resolves its inputs and calls the owning module's service. The job layer decides *when and how reliably*, never *what*.

---

## Retry

Exponential backoff, 5 attempts, then dead-letter.

| Attempt | Delay |
| --- | --- |
| 1 | immediate |
| 2 | 30 s |
| 3 | 2 min |
| 4 | 10 min |
| 5 | 1 hour |

Dead-lettered jobs are visible to Admins and replayable by a Super Admin. **A dead letter is an alert, not a silent drop** — something has failed five times and needs a human.

---

## Transactional enqueue

```ts
await prisma.$transaction(async (tx) => {
  const collection = await tx.collection.create({ ... });
  await tx.ledgerEntry.createMany({ ... });
  await tx.notification.create({ ... });
  await boss.send("push-dispatch", { notificationId }, { db: tx });
});
```

If the transaction rolls back, the job never existed. This removes the whole class of bugs where a queued job references a row that was never committed — the classic symptom being a notification about a collection that does not exist.

---

## Worker process

The same NestJS application booted with `WORKER_ENABLED=true` ([ADR-0003](adr/0003-worker-in-api-process.md)). Deployed as a separate container: a heavy reconciliation cannot slow the API, and each scales independently, while sharing the codebase, domain logic and Prisma client.

In development both run in one process for convenience.

**Graceful shutdown:** stop accepting new jobs, finish in-flight work up to a timeout, then exit. Unfinished jobs return to the queue.

---

## Observability

| Signal | Where |
| --- | --- |
| Job duration, outcome | Structured logs, OpenTelemetry spans |
| Queue depth | `/health/ready` |
| Dead-letter count | Admin screen, alert on non-zero |
| Schedule last-run | Admin screen |

**Alert if a scheduled job has not run within twice its interval.** A job that silently stops running is worse than one that fails — `reconcile-balances` not running means cache drift goes undetected, which is precisely what it exists to catch.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Silent job failure | Structured logs, dead-letter alerting, missed-run detection |
| Non-idempotent handler corrupts on retry | Required by convention; every handler has a run-twice test |
| Overlapping runs | Singleton keys |
| Queue depth grows during peak sync | Worker scales independently; `push-dispatch` is the only high-volume queue |
| Timezone drift on the worker host | Schedules declare timezone; `/health/info` reports server time |
| pg-boss schema migration on upgrade | Version pinned; upgrades tested against a database copy |
