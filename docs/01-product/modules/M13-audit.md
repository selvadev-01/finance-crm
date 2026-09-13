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

---

## What is audited

| Action               | Recorded                                             |
| -------------------- | ---------------------------------------------------- |
| `CREATE`             | Customers, accounts, staff, sectors, lines, holidays |
| `UPDATE`             | Any change to the above, with before/after           |
| `DELETE`             | Soft deletes                                         |
| `APPROVE` / `REJECT` | Collection corrections                               |
| `LOGIN`              | Every sign-in, success and failure                   |
| `REOPEN_DAY`         | Manual reopen, with reason                           |

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
