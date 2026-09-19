# ADR-0014 — Refused attempts go in their own table, not the audit log

**Status:** Accepted · 2026-09-19 · Extends [M13](../../01-product/modules/M13-audit.md) and [M02](../../01-product/modules/M02-access-control.md); does not change [ADR-0006](0006-append-only-ledger.md)'s append-only rule for money

## Context

Every guard in the system throws before anything is written. `PolicyGuard` refuses a role that lacks a permission; `StaffAdminService` refuses a role above the caller's own, an action on someone senior, and anything aimed at the caller themselves; `SettingsService` refuses a setting that may never move or may no longer move; repositories answer `404` for a row outside the caller's scope.

None of that left a record. `AuditWriter` refuses to run outside a transaction — deliberately, so an audited change can never commit unaudited — and a guard throws before any transaction opens, so the writer could not have been called even if someone had thought to. All a refusal produced was one `warn` line from the exception filter, carrying the code and the status, in a log with no retention policy and no reader.

That is the wrong side of the trade for the attempts that matter. An Admin who tries five times in a minute to create a `SUPER_ADMIN`, or to suspend the owner, is doing the single most dangerous thing the role model exists to prevent; the owner has no way to find out. A security review of [US-092](../../06-delivery/backlog.md) raised it.

The obvious home was `audit_log`, and it does not work. `audit_log` rejects `UPDATE` and `DELETE` by trigger, and `test/rbac-matrix.e2e-spec.ts` is generated from the live route table: it asserts a refusal for **every role × every protected route**, several hundred per run, against the one development database Rasi has. Writing those into an undeletable table would put tens of thousands of rows of test noise into the shared schema within a month, and no cleanup could ever remove them.

## Decision

**A refused security-relevant attempt is recorded in its own table, `security_event`, which is deletable; it is written outside any transaction, best-effort, and it never changes the request it observes.**

- **A separate table, because a refusal is not an audit of a write.** `audit_log` answers "what changed, from what to what". A refusal changed nothing: there is no before, no after, and no entity whose history it belongs to. Its columns are different — route, method, HTTP status, error code, the role at the moment of the attempt — and forcing them into `entityTable` / `entityId` / `before` / `after` would make both tables harder to read.
- **Not append-only.** `audit_log` is immutable because it is the record of money changing hands and must survive anyone who would rather it did not. `security_event` is operational telemetry about people. Making it immutable would buy nothing, and would cost the only database Rasi has: the RBAC matrix suite could not run. `deleteTestRunData` removes the rows a test created, and the organization foreign key cascades.
- **Written on the base client, never inside the caller's transaction.** The inverse of `AuditWriter`'s rule, and for the inverse reason: an audit entry must share the fate of the change it describes, while a refusal has no change to share a fate with — and `SETTING_LOCKED_BY_HISTORY` is raised _inside_ a transaction that is about to roll back, which would take the record with it. Services therefore call the recorder once the transaction has already rejected.
- **Recording never breaks the request.** `SecurityEventRecorder.refused` catches its own failures, logs them at `error`, and returns. Callers hand it the error they are about to rethrow and then rethrow that same object: the code, the status and the message the client sees are identical whether or not the row was written.
- **A short, explicit list of what is recorded** (`security-refusals.ts`), by error code: `PERMISSION_DENIED`; the rank and self guards (`ROLE_ABOVE_OWN`, `CANNOT_MANAGE_HIGHER_ROLE`, `CANNOT_RESET_SUPER_ADMIN`, `CANNOT_CHANGE_OWN_ROLE`, `CANNOT_CHANGE_OWN_STATUS`); the settings locks (`SETTING_IMMUTABLE`, `SETTING_LOCKED_BY_HISTORY`); and the two administration 404s, `STAFF_NOT_FOUND` and `SETTING_NOT_FOUND`. Anything else — a validation error, a taken email, an unchanged value, an infrastructure failure — passes through unrecorded.
- **The list is necessary, not sufficient: coverage is per call site.** A code in the list is recorded only where the service that throws it calls `security.refused`. The first security review of this ADR found `POST /api/staff/:id/password-reset` throwing `CANNOT_RESET_SUPER_ADMIN` and `STAFF_NOT_FOUND` without recording either — the owner-takeover attempt this log exists for, absent from it. That is the failure mode to watch: adding a throw site for a listed code is the moment to wire the recorder, and the explicit-call design (below) is what makes it possible to forget.
- **Ordinary out-of-scope 404s are deliberately excluded.** A Senior opening another line's customer, account or collection produces them constantly in normal work: a bookmark, a notification deep link opened after a reassignment, a phone replaying an id from its outbox. Recording them would bury the handful of rows that matter under thousands that do not, and a security log nobody can read is worse than none. The two that are kept sit on administration routes whose ids never circulate, so a miss there is someone finding out who else exists.
- **Curated facts only.** The row keeps the actor, their role, the route pattern and method, the target id, the code, the status, the IP address, the user agent, and a small `detail` object — the attempted role, the attempted status, the permission reached for. **Never a request body.** A refused staff creation records `{ attemptedRole: "SUPER_ADMIN" }` and stores nothing of the name, email address, mobile number or password that came with it; `SAFE_LOG_KEYS` is the same line drawn for logs.
- **Read by `audit.view`** — Admin and Super Admin, the roles that read the audit log — at `GET /api/security-events`, and shown at `/settings/security` beside it. No RBAC matrix cell changes.
- **HTTP tests record to memory**, exactly as they already do for `AuditWriter`: `test/app.ts` subclasses the recorder and replaces only the insert. Tier 1 proves the real rows inside `withRollback`. Without this the RBAC matrix suite would still write and then delete several hundred rows a run.

## Consequences

**Good**

- An insider probing the boundary of their role leaves a durable, filterable trail, with the attempted role or permission named
- The RBAC matrix suite keeps working unchanged, against the one database, with no growth in the shared schema
- The audit log stays exactly what it says it is: a record of changes, all of which happened
- A failed record can never turn a `403` into a `500`, and can never hide the refusal

**Bad**

- **Two logs to look at.** Someone investigating an incident reads `/settings/audit` and `/settings/security`. They are not joined, and nothing correlates an attempt with the change the same person made a minute later except the actor and the timestamp
- **Best-effort means exactly that.** A database that cannot take the row loses the record; only the `error` log line remains. This is the right trade — the alternative is refusing the request — but it means the log is not evidence in the way the ledger is
- **No retention or pruning.** The table grows without bound. Unlike `audit_log` it can be deleted from, so a scheduled prune is a small job when volume asks for it; it is not built
- **The recorded route is the pattern, not the path.** `/api/staff/:staffProfileId/role` with the id in its own column, which reads better and filters better, but means a refusal at a route taking two parameters records neither

## Alternatives considered

- **Write refusals into `audit_log` with a new `DENY` action.** Rejected on the test conflict alone — the RBAC matrix would mass-write an undeletable table on every run, for ever, in the only database. Independently, the audit log's shape does not fit an event with no before and no after, and its immutability is a promise made about money.
- **Narrow what is recorded so the matrix suite never triggers it** — for example, only the service-level guards, not `PolicyGuard`. Rejected because it does not hold: the suite hits **every** route with **every** role, so it reaches the rank guards and the settings locks as readily as the permission check. Any rule narrow enough to dodge it would also miss the real attempts.
- **Record only to the log, with a longer retention.** Rejected: the console is where the owner looks, log retention is an infrastructure decision Rasi has deferred, and a pino line cannot be filtered by actor or date by someone who is not an engineer.
- **Record from the global exception filter**, one place for every refusal. Attractive, and rejected for two reasons: it would invert the module layering by making `platform/errors` depend on a feature module, and it would lose the facts only the throw site knows — which role was reached for, which permission was missing. The house pattern is already explicit calls (M13, decided 2026-09-15: no event bus), held to by `audit-coverage.e2e-spec.ts`.
