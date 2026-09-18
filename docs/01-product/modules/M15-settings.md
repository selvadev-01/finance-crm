# M15 — Settings

**Purpose:** business rules that may change without a deployment, and feature flags.

**Source:** PDF §25 (Settings navigation), §26 (Super Admin full access).

---

## Scope

**In:** business settings, feature flags, organisation profile.

**Out:** infrastructure configuration — that is environment variables (M16).

---

## Owned entities

`setting` · `organization`

---

## The dividing line

| Belongs in `setting`           | Belongs in env               |
| ------------------------------ | ---------------------------- |
| Changes business behaviour     | Changes deployment behaviour |
| A Super Admin should change it | An operator should change it |
| Safe to change at runtime      | Requires a restart           |
| Example: default term days     | Example: `DATABASE_URL`      |
| Example: job cron expressions  | Example: `PUSH_PROVIDER`     |

> The test is _who should be allowed to change this, and does changing it need a deploy_. Putting a cron expression in code means changing a schedule requires a release; putting a database URL in the settings table means a misconfigured row takes the application down with no way to fix it from outside.

---

## Settings

| Key                                  | Default     | Effect                                                | Built                  |
| ------------------------------------ | ----------- | ----------------------------------------------------- | ---------------------- |
| `account.defaultTermDays`            | `100`       | Pre-filled term on the creation form                  | Yes (US-094)           |
| `account.overdueGraceDays`           | `0`         | Days past target before `isOverdue` (open question 3) | Yes (US-094)           |
| `collection.varianceTolerance`       | —           | **Not implemented.** Exact match is the rule (BR-08)  | No, by decision        |
| `dayClose.autoCloseTime`             | `null`      | Optional automatic close; null means manual only      | No — no consumer yet   |
| `notification.alertCategoriesLocked` | `["ALERT"]` | Categories users cannot opt out of                    | No — settled in M10    |
| `jobs.*.cron`                        | see M14     | Schedule expressions                                  | No — settled in M14    |
| `sync.maxUnsyncedWarning`            | `100`       | Warn the Junior at this queue depth                   | No — the phone is off  |
| `sync.maxUnsyncedHard`               | `300`       | Block further entries beyond this                     | No — the phone is off  |

> **A setting nobody reads is worse than no setting**, which is the same reasoning that keeps `collection.varianceTolerance` out. So US-094 shipped only the keys with a live consumer. The sync thresholds are the interesting case: they govern what a Junior's phone does **while it has no signal**, so a database value could not be read at the moment it is needed — wiring them means caching them into the route payload first, and that is an offline decision (M08, offline-sync.md), not a settings one.

### `collection.varianceTolerance` is listed but not built

> An unused tolerance of zero is indistinguishable from no tolerance at all, so the setting would be dead configuration — a knob that does nothing, which is worse than no knob. It is documented here so that if alert volume proves the need after launch, the shape of the addition is already decided: one settings row and one comparison in M07.

---

## Feature flags

Environment-driven, not database-driven — they gate code paths, and a database flag that turns on unfinished code is a deployment risk rather than a feature.

| Flag             | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `PUSH_PROVIDER`  | `WEB_PUSH` \| `FCM` \| `BOTH` \| `NONE` (M10) |
| `WORKER_ENABLED` | Run job consumers in this process (M14)       |     | `OFFLINE_SYNC_ENABLED` | Kill switch for the offline outbox |

`PUSH_PROVIDER=NONE` is the development default so local work raises no push traffic. `BOTH` exists for the migration window if the business moves between providers.

---

## Organisation profile

One row per organization: name, `slug` (its sign-in link, generated from the name), `timezone` (`Asia/Kolkata`), `currency` (`INR`). Created by organization sign-up ([ADR-0012](../../02-architecture/adr/0012-organization-sign-up.md)). Setting keys are unique within an organization, so each business overrides its own. **The timezone value is informational only** — `Asia/Kolkata` is settled in code (BR-12), because making the business date configurable would mean every date calculation depends on a database read, and a wrong value would silently misfile every collection.

---

## Operations

| Operation                 | Actor                |
| ------------------------- | -------------------- |
| View settings             | Super Admin          |
| Change a setting          | **Super Admin only** |
| View organisation profile | Admin+               |

Every change is audited (M13) with before and after values.

> Settings are Super Admin only because they alter business rules. An Admin changing the default term or a job schedule is not an operational act — it changes how the system behaves for everyone.

---

## Risks

| Risk                                      | Mitigation                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| A setting change breaks running behaviour | Each is validated on write against a schema; invalid values rejected                      |
| Settings drift from documented defaults   | Defaults live in code; the table holds only overrides, and the settings screen shows both |
| Cron changed to an invalid expression     | Parsed and validated before saving; rejected with the parse error                         |
| Timezone changed by accident              | Not settable — informational only                                                         |
| A setting change restates history         | Every setting is classified free / forward-only / locked, and the class is an API refusal |

---

## As built — business settings (US-094, 2026-09-18)

Two routes in `apps/api/src/settings/`, both **Super Admin only** — a new `settings.view` permission beside the existing `settings.change`, with a "View settings" row added to the [RBAC matrix](../rbac-matrix.md#administration-m01-m13-m15):

| Route                     | Permission        | Answers                                                       |
| ------------------------- | ----------------- | ------------------------------------------------------------- |
| `GET /api/settings`       | `settings.view`   | Every setting, its value, its default and whether it may move |
| `PATCH /api/settings/:key`| `settings.change` | One change, or `value: null` to drop the override             |

Defaults live in `setting-registry.ts`, the `setting` table holds overrides only, and a reset removes the row — so a value nobody changed reads the same in the database, in a fresh organisation and in the code. Values cross the API as **strings** whatever their type, so a money-shaped setting would be a decimal string and never a JSON number (BR-11).

### Which settings can change safely, and which would rewrite history

This is the question the story turns on, and the answer is enforced by the API rather than by leaving a button off a screen. Every entry in the registry declares one of three classes:

| Class            | Meaning                                                       | Settings                                                    | Enforcement                                                        |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| **Free**         | The new value applies; nothing stored is restated              | `organisation.name`, `account.overdueGraceDays`              | None needed                                                        |
| **Forward only** | Read **once**, at creation, and copied onto the record         | `account.defaultTermDays`                                    | Architectural: `account_loan.termDays` is stamped and never re-read |
| **Locked**       | Refused — changing it would restate what is already posted     | `organisation.slug`, `organisation.timezone` (always); `organisation.currency` (once any account exists) | `422 SETTING_IMMUTABLE` / `422 SETTING_LOCKED_BY_HISTORY`           |

- **`organisation.name`** is display only. No figure, date or schedule derives from it.
- **`account.overdueGraceDays`** reaches accounts that already exist, and is still free: `isOverdue` is a **derived flag**, recomputed from the dates on every run of `flag-overdue-accounts` (BR-05). It restates no amount and moves no slot. Zero remains the default, which is [open question 3](../business-rules.md)'s answer.
- **`account.defaultTermDays`** is the forward-only case, and the guard is the absence of a read rather than a refusal: an account's N is copied onto `account_loan.termDays` at creation and its schedule generated from it (BR-04/06/07). Nothing re-reads the setting for an account that exists, which a Tier 1 spec proves by changing the default from 100 to 60 and asserting the account's term, target completion date and every schedule slot are untouched.
- **`organisation.slug`** and **`organisation.timezone`** are refused outright. The slug is generated once at sign-up ([ADR-0012](../../02-architecture/adr/0012-organization-sign-up.md)) and every staff member has that link saved; the time zone is settled in code as `Asia/Kolkata` (BR-12), so a different value here would change nothing or silently misfile every collection recorded near midnight. Both are **shown** on the screen — read-only, with the reason — because hiding them invites someone to go looking for them.
- **`organisation.currency`** can be corrected while the organisation has no account at all, and is refused the moment one exists: every posted account, collection and ledger entry is in it, and changing it would relabel them without converting a figure. The check reads `account_loan` **inside the transaction**, so an account created concurrently either is seen or waits.

A change the registry cannot parse is `400 SETTING_VALUE_INVALID` with the detail at the `value` field; an unknown key is `404` (the same answer as out of scope, M02); writing the value already in force is `422 SETTING_UNCHANGED`, so every audit entry records a real change.

### Auditing

Each write calls `AuditWriter.record` inside `Database.transaction`, with `before` and `after` naming the setting and both values: `setting` `CREATE` when an override first appears, `UPDATE` when it moves, `DELETE` on a reset, and `organization` `UPDATE` for the organisation's own columns. Both tables joined `AUDITED_TABLES`, so they are filterable in the audit log (US-090).

### Consumers

Nothing here is a knob that does nothing:

- `OverdueService` reads `account.overdueGraceDays` for the nightly BR-05 pass.
- `GET /api/me` carries `organisation.defaultTermDays` to every console user, and the account creation form (S-11) starts N at it. It rides on `/api/me` rather than on `/api/settings` because an **Admin** creates accounts and the settings routes are the Super Admin's alone.

### Console

S-28 at `/settings`, and "Business settings" in the System nav for the Super Admin alone. Each setting shows its class as a badge, what changing it does, and — when it is locked — why, in place of the button. Changing a locked-but-still-editable setting (the currency, before the first account) warns before it is saved, and "Reset to default" is a confirmed action that never precedes "Change" in the DOM.

### What is not built

`dayClose.autoCloseTime`, `notification.alertCategoriesLocked`, `jobs.*.cron` and the two `sync.*` thresholds are not settings yet — see the table above for why each waits.
