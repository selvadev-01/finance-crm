# M13 — Audit

**Purpose:** an immutable record of who did what, when, and what changed.

**Source:** not in the PDF. Added because §29's _"the Super Admin controls the complete business"_ is unenforceable without it.

---

## Scope

**In:** the audit trail, entity history views, retention.

**Out:** the financial trail itself — that is the ledger (M09). Audit records _actions_; the ledger records _money_.

---

## Owned entities

`audit_log` — append-only, no `updatedAt`, no delete path, writable by no role.

`security_event` — the attempts that were **refused** (ADR-0014). Deliberately not append-only: nothing changed, so there is nothing to be immutable about, and the RBAC matrix suite refuses every route for every role on every run.

---

## What is audited

| Action               | Recorded                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATE`             | Customers, accounts, staff, sectors, lines, holidays                                                                                                                                                                                                                            |
| `UPDATE`             | Any change to the above, with before/after                                                                                                                                                                                                                                      |
| `DELETE`             | Soft deletes; a removed future holiday (US-093)                                                                                                                                                                                                                                 |
| `APPROVE` / `REJECT` | Collection corrections                                                                                                                                                                                                                                                          |
| `LOGIN`              | Every sign-in, success and failure                                                                                                                                                                                                                                              |
| `REOPEN_DAY`         | Manual reopen, with reason                                                                                                                                                                                                                                                      |
| `EXPORT`             | A report, dashboard or the collection list downloaded as Excel or PDF (M12): `entityTable` `export`, `entityId` the export's name, `after` its format, filters, rows and file name. Like `LOGIN`, nothing changed — it records which figures left the system, and who took them |

Each entry records actor, entity table and id, action, before/after JSON, IP address, user agent and timestamp. System actions (scheduled jobs, automatic day reopen) record a null actor and are labelled as system.

### Collections are not audited as updates

Collections are append-only (BR-14) — there is nothing to audit, because nothing changes. The correction _approval_ is audited; the collection records themselves are their own history.

> This is the point of append-only. An audit log that catches unauthorised changes is a detective control; a structure where the change cannot happen is a preventive one. The audit log covers what remains mutable.

---

## Design

**Written in the same transaction as the change it records.** An audited action that commits without its audit entry is an unaudited action.

**Before/after as JSON snapshots** rather than per-field rows.

> Write volume is high and reads are investigative and rare — someone looks at the audit log when something has gone wrong, perhaps monthly. A compact append optimised for writing is the right trade-off; a normalised per-field structure would pay a cost on every write to make an uncommon read slightly nicer.

**Retention: 7 years.** Financial record-keeping. Rows older than the operational window are partitioned by year so the active table stays small.

---

## Entity history view

Given any account, the full chronological trail: creation, disbursement, every collection with variance and collector, adjustments and their approvals, day closes it fell within, completion.

This assembles the audit log with the collection and ledger records — the screen an Admin opens when a customer disputes a figure, and the reason the system can answer rather than argue.

---

## Operations

| Operation                             | Actor           |
| ------------------------------------- | --------------- |
| View audit log                        | Admin+          |
| View refused attempts                 | Admin+          |
| Filter by actor, entity, action, date | Admin+          |
| View entity history                   | Admin+          |
| Write                                 | **System only** |
| Modify or delete                      | **Nobody**      |

Seniors and Juniors have no access. The audit log records their actions; exposing it to them serves no operational purpose and reveals other staff members' activity.

---

## As built

**`AuditWriter`** (`apps/api/src/audit/`) records `CREATE` and `UPDATE` for sectors, lines and line assignments (M03), with before/after snapshots of the changed fields, the actor from the request context, and IP address and user agent from the request. **It refuses to write outside a transaction** (`AUDIT_OUTSIDE_TRANSACTION`), so an entry always commits or rolls back with its change — the same-transaction rule, enforced rather than remembered.

**`LOGIN`** is written by the sign-in hooks in `apps/api/src/auth/` ([M01 as built](M01-identity.md#as-built--sign-in)). Two departures from the design above, both deliberate:

- **Written directly, not from an event.** No event bus exists yet. When one does, the sign-in hook becomes an event emitter and this module the writer.
- **Not in the same transaction as the session.** Better Auth creates the session in its own write. The equivalent guarantee is kept by undoing the session when the audit write fails.

Rows carry `after: { outcome, reason }`, IP address and user agent. For an attempt matching no user, `actorUserId` is null and `entityId` is `unknown`; the typed email is not stored.

**The write path is direct calls, not an event bus** (decided 2026-09-15). Every service calls `AuditWriter.record` (or `recordSystem` for a job) inside its own transaction, which already guarantees the same-transaction rule. The risk the event bus was meant to remove — a new write that nobody remembered to audit — is covered by `test/audit-coverage.e2e-spec.ts` instead: every write route the app serves must be classified as audited, naming the table and action it records, or as not audited with a reason, and each declared table and action must have a writer in the source that records that table with that action in the same entry. A new write route fails the suite until someone decides. Routes marked not audited: the account preview (writes nothing), the phone's sync report, and the user's own notifications, devices and preferences.

**Every entry names its organization** (`audit_log.organizationId`, 2026-09-15), from the request or system context, or for a sign-in from the matched staff member. Rows written before the column existed cannot be backfilled — the table rejects UPDATE — so they are not in any organization's log, though an account's history still finds them by record id.

**Audit log (US-090, S-29).** `GET /api/audit-log` (`audit.view`, Admin and Super Admin) lists the caller's organization newest first, filtered by staff member, record type, record id, action and business-date range (converted with `businessDayStart` in `packages/domain`), cursor-paged. Each entry carries the actor's name, or none for a system action or an unknown sign-in, a `system` flag, the before and after snapshots, IP address and user agent. The console page `/settings/audit` keeps its filters in the URL, opens each entry to a field-by-field before/after, and pages with "Older entries". The reconciliation alert (M10) links to it.

**Account history (US-091).** `GET /api/accounts/:accountId/history` (`audit.view`) assembles, oldest first: the account's audit entries (created, disbursed, reconciliation findings) and the approve / reject entries of its corrections; every collection and adjustment with amount, expected, variance, classification, status, collector, note and approval (who asked, why, who decided, with their note); and the day closes of the lines and dates its collections fell on, with those days' own audit entries, because a day_close row keeps only its latest state and a reopen would otherwise vanish. The collections' own CREATE entries are left out — the collection rows are their history. The account page shows it to Admins.

**Refused attempts (S-31, [ADR-0014](../../02-architecture/adr/0014-security-event-log.md)).** Every guard in the system throws before a transaction opens, so `AuditWriter` — which refuses to run outside one — could never have seen a refusal; all one produced was a `warn` line. `security_event` records them instead: actor and their role at the time, route pattern and method, target id, the stable error code, the HTTP status, IP address, user agent, and a small `detail` object naming the attempted role, the attempted status, or the permission reached for.

- **Its own table, not `audit_log`.** A refusal changed nothing, so there is no before, no after and no entity whose history it belongs to — and `audit_log` rejects DELETE, which would make `test/rbac-matrix.e2e-spec.ts` (a refusal for every role × every protected route, several hundred per run) fill the only database for ever. `security_event` is deletable and cascades with its organization.
- **Written outside every transaction**, on the base client — the inverse of the audit rule, because `SETTING_LOCKED_BY_HISTORY` is raised inside a transaction that is about to roll back and would take the record with it. Services call the recorder once their transaction has already rejected.
- **`SecurityEventRecorder.refused` never changes the request it observes.** It swallows its own failures, logs them at `error`, and returns; the caller rethrows the same error object, so the client sees the identical code, status and message whether or not the row landed.
- **A short list, by error code** (`src/security/security-refusals.ts`): `PERMISSION_DENIED` at `PolicyGuard`; the rank and self guards `ROLE_ABOVE_OWN`, `CANNOT_MANAGE_HIGHER_ROLE`, `CANNOT_RESET_SUPER_ADMIN`, `CANNOT_CHANGE_OWN_ROLE`, `CANNOT_CHANGE_OWN_STATUS` (M01); the settings locks `SETTING_IMMUTABLE`, `SETTING_LOCKED_BY_HISTORY` (M15); and the administration 404s `STAFF_NOT_FOUND`, `SETTING_NOT_FOUND`. A validation error, a taken email, an unchanged value and an infrastructure failure are not recorded.
- **Coverage is per call site, not per code.** Naming a code in that list records nothing on its own: the service that throws it has to hand it to the recorder. A security review on 2026-09-19 found `POST /api/staff/:id/password-reset` throwing both `CANNOT_RESET_SUPER_ADMIN` and `STAFF_NOT_FOUND` without recording either — an Admin reaching for the owner's account through a forced reset, invisible on the one screen built so the owner could see it. Both are wired now. Any new throw site for a listed code must call `security.refused` too.
- **Ordinary out-of-scope 404s are deliberately left out** — a Senior opening another line's customer, account or collection is routine (a bookmark, a deep link after a reassignment, a phone replaying an id), and burying the real attempts under them would destroy the log's value.
- **Never a request body.** A refused staff creation records `{ attemptedRole: 'SUPER_ADMIN' }` and none of the name, email, mobile number or password it carried — the line `SAFE_LOG_KEYS` draws for logs.
- **`GET /api/security-events`** (`audit.view`, so no RBAC cell changed) lists the caller's organization newest first, filtered by staff member, kind, code and business-date range, cursor-paged. The console page is `/settings/security`, beside the audit log, with its filters in the URL.

**Not built:** yearly partitioning and 7-year retention (deferred to Phase 6, decided 2026-09-15), a redaction allowlist for snapshots (writers record chosen fields, never credentials), entity history for anything but accounts, the `(actorUserId, createdAt)` index (separate indexes exist).

**Testing.** `audit_log` rejects DELETE, so HTTP tests cannot leave real audit rows in the shared development schema. They record attempts and `AuditWriter` entries in memory (`test/app.ts` subclasses the real writer, so its transaction check still runs), and rolled-back Tier 1 tests prove the real rows. Every future audited action needs the same split.

---

## Events consumed

All modules emit domain events; this module subscribes broadly rather than each module writing its own audit rows.

> Centralising the write means audit coverage is a property of the event bus rather than a discipline each module must remember. A new module that emits events is audited by default, instead of being audited only if its author remembered to add the call.

---

## Risks

| Risk                                        | Mitigation                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Audit write fails silently, action succeeds | Same-transaction write; failure rolls back the action                                    |
| Log growth degrades performance             | Yearly partitioning; indexed on `(entityTable, entityId)` and `(actorUserId, createdAt)` |
| Sensitive data in before/after snapshots    | Credential fields are redacted before writing; enforced by a field allowlist             |
| An action is missed                         | Event-driven subscription, not per-module calls                                          |
