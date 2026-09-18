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

| Key                                  | Default     | Effect                                                |
| ------------------------------------ | ----------- | ----------------------------------------------------- |
| `account.defaultTermDays`            | `100`       | Pre-filled term on the creation form                  |
| `account.overdueGraceDays`           | `0`         | Days past target before `isOverdue` (open question 3) |
| `collection.varianceTolerance`       | —           | **Not implemented.** Exact match is the rule (BR-08)  |
| `dayClose.autoCloseTime`             | `null`      | Optional automatic close; null means manual only      |
| `notification.alertCategoriesLocked` | `["ALERT"]` | Categories users cannot opt out of                    |
| `jobs.*.cron`                        | see M14     | Schedule expressions                                  |
| `sync.maxUnsyncedWarning`            | `100`       | Warn the Junior at this queue depth                   |
| `sync.maxUnsyncedHard`               | `300`       | Block further entries beyond this                     |

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
