# Backlog

Stories from [`user-stories.md`](../01-product/user-stories.md), ordered by phase. Sizes are relative (S / M / L / XL), not time estimates.

**Priority:** `P0` release-blocking · `P1` needed for a usable v1 · `P2` valuable, deferrable.

**This file is the authoritative record of what is built.** One row per story, one `State` column. Update the row in the same pass that finishes the work — see [keeping this current](#keeping-this-current).

**State:** `—` not started · `WIP` in progress · `Done` merged, tested, meets the [Definition of Done](../04-engineering/definition-of-done.md) · `Blocked` with the reason in the row.

> `Done` means the DoD checklist actually passed, not that the code exists. A story with no RBAC test, or money logic without its worked-example test, is `WIP`.

---

## Progress

| Phase                   | Stories | Done | State    |
| ----------------------- | ------- | ---- | -------- |
| 0 Foundations           | 10      | 10   | **Done** |
| 1 Domain + identity     | 18      | 0    | —        |
| 2 Accounts + ledger     | 16      | 0    | —        |
| 3 Collections + offline | 18      | 0    | —        |
| 4 Cash + notifications  | 16      | 0    | —        |
| 5 Dashboards + reports  | 12      | 0    | —        |
| 6 Hardening             | 7       | 0    | —        |

**Totals: 97 stories, 10 done.** Counts are derived from the tables below — if they disagree, the tables win and the counts are stale.

---

## Phase 0 — Foundations

| Item                                                                   | Size | State                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turborepo + pnpm workspace skeleton                                    | M    | **Done**                                                                                                                                                                                                                                  |
| `@repo/eslint-config` + `@repo/typescript-config` presets              | S    | **Done**                                                                                                                                                                                                                                  |
| Root scripts — `dev`, `build`, `lint`, `check-types`, `test`, `format` | S    | **Done**                                                                                                                                                                                                                                  |
| `apps/web` and `apps/api` shells that boot                             | S    | **Done**                                                                                                                                                                                                                                  |
| Tailwind v4 preset + component base in `@repo/ui`                      | S    | **Done** — tokens as a `@theme` layer, two density modes, and a component base. Purge-safety verified against the production build                                                                                                        |
| Local PostgreSQL setup — `rasi_dev`, `public` + `test` schemas         | S    | **Done**                                                                                                                                                                                                                                  |
| `packages/db` — Prisma, migrations                                     | M    | **Done** — 28 tables, 20 enums, the named indexes and an index on every FK, across migrations `0001_add_better_auth` and `0002_rasi_core`. Raw-SQL constraints Prisma cannot express are deferred to the phase that uses them (see below) |
| `packages/domain` + `packages/contracts` — empty, boundaries enforced  | S    | **Done** — both packages build and lint clean. Boundaries enforced by two independent mechanisms and verified by a deliberate violation (see below)                                                                                       |
| Better Auth generated and mounted in NestJS                            | M    | **Done**                                                                                                                                                                                                                                  |
| Test harness — `test` schema, two-tier isolation                       | M    | **Done** — Tier 1 rollback and Tier 2 truncation both working, with the harness's own isolation asserted by tests. The auth smoke test guards `bodyParser: false`                                                                         |

> Better Auth lands in Phase 0 rather than with M01 because `better-auth generate` writes into the Prisma schema. Doing it after other tables exist means a larger, riskier migration diff.
>
> **In practice the ordering is forced, not merely preferable.** `staff_profile.userId` is a foreign key to `user.id`, and Prisma requires both sides of every relation — so the Rasi models cannot pass `prisma validate` until `model User` exists. Auth first, then the Rasi schema, in two migrations.

No containers — deferred by decision. The test harness is a Phase 0 item because the full suite is run by hand on the development machine: if running it is inconvenient from day one, it will not get run.

**One database, two schemas — not two databases.** `rasi_dev` holds development data in `public`; the test harness owns the `test` schema and truncates it between tests. `DATABASE_URL` and `TEST_DATABASE_URL` differ only by `?schema=`. A separate `rasi_test` database was specified originally and is not built: one database is less to set up, and schema separation gives the same protection — a test run cannot reach the seed data.

**The schema is complete; the database-level constraints are not.** Prisma's schema language cannot express check constraints, partial unique indexes, deferred constraint triggers or table partitioning, so these arrive as hand-written SQL in the migration belonging to the phase that needs them:

| Deferred to        | What                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 2 (M05, M09) | `profitAmount = accountAmount − investedAmount`; `investedAmount < accountAmount`; `dailyAmount ≤ accountAmount`; `dailyAmount × termDays ≥ accountAmount`; `collectedAmount ≥ 0`; the ledger balancing trigger (Σ debits = Σ credits, deferred to commit) |
| Phase 3 (M03)      | Partial unique on `line_assignment(lineId)` where `SENIOR AND effectiveTo IS NULL`; partial unique on `(staffProfileId)` where `effectiveTo IS NULL`; check `effectiveTo ≥ effectiveFrom`                                                                  |
| Phase 4 (M08, M10) | `push_subscription` provider-field check; Σ denomination subtotal = `declaredAmount`                                                                                                                                                                       |
| Phase 5 (M15)      | `holiday(date, sectorId)` needs `NULLS NOT DISTINCT` — as written the unique index permits unlimited duplicate business-wide holidays on one date                                                                                                          |
| Unscheduled        | `audit_log` yearly partitioning, which also forces a composite `(id, createdAt)` primary key                                                                                                                                                               |

Writing a deferred constraint trigger months before any code posts to the ledger would mean testing it against nothing. The risk is forgetting, which is what this table is for.

**"Transaction-rollback isolation" is delivered in two tiers, because it cannot be delivered as one.** A supertest request crosses a socket into a different async context, so the HTTP handler uses the application's Prisma client rather than the test's transaction-bound one, and no `AsyncLocalStorage` bridges that. Service and repository tests get true per-test rollback through a DI override; HTTP tests get truncation between tests. Anything written against this harness should know which of the two it is using.

**`?schema=` does not work at runtime under Prisma 7, and that nearly cost the development data.** It is a Prisma-specific query parameter: the CLI parses it, so `migrate deploy` targets the right schema — but `pg` silently ignores unknown parameters, so with driver adapters it sets no `search_path`. Migrations went to `test` while the application read and wrote `public`, meaning the harness truncated an empty schema while the real one filled up. `@repo/db` now parses `?schema=` and passes it to the adapter explicitly.

Two consequences worth knowing before writing tests against this:

- The adapter's `schema` option qualifies **generated** queries (`test."user"`), but does not change `search_path`. `current_schema()` still reports `public`, so **raw SQL must name its schema explicitly** — which is why truncation filters on `schemaname` and fully qualifies each table.
- `DATABASE_URL` is redirected at **vitest config scope**, not in a setup file. Config is evaluated in the parent process before workers fork, and workers inherit the environment; `test.env` is applied too late for a module that reads the variable while importing.

The harness asserts its own isolation — that a model write lands in `test` and not `public`, and that the run refuses to start unless `TEST_DATABASE_URL` names the `test` schema. Those assertions are cheap and they are why the rest can be trusted.

---

## Phase 1 — Domain and identity

| Story                                               | Size  | Pri | State |
| --------------------------------------------------- | ----- | --- | ----- |
| **`packages/domain` — working calendar (M06)**      | **L** | P0  | —     |
| `packages/domain` — schedule generation (BR-04)     | M     | P0  | —     |
| `packages/domain` — variance classification (BR-08) | S     | P0  | —     |
| `packages/domain` — profit apportionment (BR-18)    | M     | P0  | —     |
| US-034 Working-day calculation                      | —     | P0  | —     |
| US-001 Staff sign-in                                | M     | P0  | —     |
| US-002 Sign out, blocked while queued               | S     | P0  | —     |
| US-003 Password reset                               | S     | P1  | —     |
| US-004 Server-side scope enforcement                | **L** | P0  | —     |
| M16 Platform — config, logging, errors, health      | M     | P0  | —     |
| US-010 Manage sectors                               | S     | P0  | —     |
| US-011 Manage lines                                 | S     | P0  | —     |
| US-012 Assign Senior to line                        | M     | P0  | —     |
| US-013 Move a Junior between lines                  | M     | P0  | —     |
| US-014 View who is on which line                    | S     | P1  | —     |
| US-015 View assignment history                      | S     | P2  | —     |
| **RBAC matrix test harness**                        | M     | P0  | —     |
| **Seed dataset**                                    | **L** | P0  | —     |

> The RBAC test harness is a story, not a chore. It generates a test per matrix cell, so a new endpoint without matrix entries fails the suite — which is what makes release gate 5 real rather than aspirational.

**The seed dataset** is the only dataset anyone will see before launch, so it carries the awkward cases deliberately — uneven final instalment, overdue account, two concurrent accounts, mid-account line transfer, cash discrepancy, approved correction. Sized L rather than S because generating a month of plausible collection history across 250 accounts, with realistic low/extra/missed distribution, is real work — and a seed of perfect happy-path data would be worth very little.

---

## Phase 2 — Customers, accounts, ledger

| Story                                        | Size  | Pri | State |
| -------------------------------------------- | ----- | --- | ----- |
| US-020 Onboard a customer                    | M     | P0  | —     |
| US-021 Edit a customer                       | S     | P1  | —     |
| US-024 Search customers                      | S     | P1  | —     |
| US-023 Transfer a customer to another line   | S     | P1  | —     |
| US-030 Create an account                     | **L** | P0  | —     |
| **US-030a Create a mid-term account**        | M     | P0  | —     |
| US-031 Uneven final instalment               | S     | P0  | —     |
| US-032 Disburse an account                   | M     | P0  | —     |
| US-033 Account completes on balance          | M     | P0  | —     |
| US-035 Close an account manually             | S     | P2  | —     |
| M09 Ledger — accounts, transactions, entries | **L** | P0  | —     |
| **Ledger balancing trigger**                 | M     | P0  | —     |
| M13 Audit — event-driven trail               | M     | P0  | —     |
| US-090 Audit log                             | M     | P0  | —     |
| US-022 Customer 360                          | M     | P1  | —     |
| US-091 Investigate an account's history      | M     | P1  | —     |

---

## Phase 3 — Collections and offline

The riskiest phase. Offline infrastructure precedes the screens that depend on it.

| Story                                                 | Size   | Pri | State |
| ----------------------------------------------------- | ------ | --- | ----- |
| M07 Collections — entry, variance, attribution freeze | **L**  | P0  | —     |
| **Idempotency infrastructure (BR-13)**                | **L**  | P0  | —     |
| **IndexedDB outbox**                                  | **XL** | P0  | —     |
| **Background Sync + four fallback drains**            | **L**  | P0  | —     |
| US-040 View today's route                             | M      | P0  | —     |
| US-041 Record a collection                            | M      | P0  | —     |
| US-042 Split a payment across accounts                | M      | P1  | —     |
| US-050 Record with no network                         | —      | P0  | —     |
| US-051 Route available offline                        | M      | P0  | —     |
| US-052 Automatic sync on reconnect                    | —      | P0  | —     |
| US-053 Replay creates no duplicates                   | —      | P0  | —     |
| US-054 Honest sync status                             | M      | P0  | —     |
| US-056 Device storage limits                          | S      | P2  | —     |
| US-043 Missed collections detected                    | M      | P0  | —     |
| US-044 Request a correction                           | M      | P1  | —     |
| US-045 View collection history                        | S      | P1  | —     |
| **Offline E2E suite (Playwright)**                    | **L**  | P0  | —     |
| **Real-device testing on mid-range Android**          | M      | P0  | —     |

> Real-device testing is its own line item because emulators do not reproduce the failure modes that matter: aggressive background-process killing, storage pressure, and a radio that flickers rather than cleanly disconnecting.

---

## Phase 4 — Cash control and notifications

| Story                                            | Size  | Pri | State |
| ------------------------------------------------ | ----- | --- | ----- |
| US-060 Close the day for a line                  | M     | P0  | —     |
| US-055 Late sync reopens a closed day            | M     | P1  | —     |
| US-061 Hand over cash with denominations         | M     | P0  | —     |
| US-062 Acknowledge a handover                    | S     | P0  | —     |
| US-064 Senior hands over to Admin                | S     | P0  | —     |
| US-063 Dispute a handover                        | S     | P1  | —     |
| US-065 Investigate a discrepancy                 | S     | P1  | —     |
| M14 Jobs — pg-boss, queues, retries, dead-letter | **L** | P0  | —     |
| **US-095 Nightly reconciliation**                | M     | P0  | —     |
| M10 Notifications — centre, outbox, fan-out      | **L** | P1  | —     |
| `packages/notifications` — Web Push provider     | M     | P1  | —     |
| `packages/notifications` — FCM provider          | M     | P1  | —     |
| US-070 Notification centre                       | M     | P1  | —     |
| US-071 Push notifications                        | M     | P1  | —     |
| US-072 Senior alerts                             | M     | P0  | —     |
| US-073 Notification preferences                  | S     | P2  | —     |

---

## Phase 5 — Dashboards and reports

| Story                              | Size  | Pri | State |
| ---------------------------------- | ----- | --- | ----- |
| US-080 Super Admin overview        | **L** | P1  | —     |
| US-081 Sector comparison           | M     | P1  | —     |
| US-082 Admin operational dashboard | M     | P1  | —     |
| US-083 Senior line dashboard       | M     | P1  | —     |
| US-084 Line-wise report            | M     | P1  | —     |
| US-085 Investment overview         | M     | P1  | —     |
| US-086 Collection report           | M     | P1  | —     |
| US-087 Overdue report              | S     | P1  | —     |
| Discrepancy report                 | S     | P1  | —     |
| US-092 Manage staff                | S     | P1  | —     |
| US-093 Declare holidays            | M     | P1  | —     |
| US-094 Business settings           | S     | P2  | —     |

> No P0 stories in this phase. Dashboards are how the business _sees_ the data, and nothing is lost if they arrive late — whereas a collection that fails to record is gone. This is the phase to compress if the schedule slips.

---

## Phase 6 — Hardening

| Item                                               | Size | State |
| -------------------------------------------------- | ---- | ----- |
| Full E2E suite green                               | M    | —     |
| Security review against `security.md`              | M    | —     |
| Performance verification against NFR targets       | M    | —     |
| **Mid-term account verification — release gate 6** | M    | —     |
| **Onboarding + account form throughput pass**      | M    | —     |
| Staff training materials                           | M    | —     |
| Release-gate verification suite                    | M    | —     |

> The throughput pass is a real story, not polish. Every customer at launch is entered by hand through these two forms — keyboard-first, correct tab order, submit-and-create-another without a reload, inline validation at the field. Three seconds saved per customer is an hour saved across 1,000 of them, and it is far cheaper to fix here than while five people are typing under pressure.

---

## Keeping this current

When a story is finished, in the same pass:

1. **Set its `State` here to `Done`.** A story half-built is `WIP`, with the remaining part named in the row if it is not obvious.
2. **Update the progress counts** at the top of this file.
3. **If a package, database or piece of infrastructure now exists**, remove it from the gap table in [`project-structure.md`](../04-engineering/project-structure.md#not-yet-present) and add it to the workspace tree there.
4. **If behaviour ended up different from the spec**, fix the module spec in `01-product/modules/` — the spec is wrong, not the code, once the code ships. A decision that is hard to reverse also gets an [ADR](../02-architecture/adr/).
5. **At a phase boundary only**, update the phase marker in [`roadmap.md`](roadmap.md) and the implementation table in [`../README.md`](../README.md). Those are coarse summaries; per-story state lives here and nowhere else.

Do not record status in two places. If another document needs to state progress, it links here.

---

## Not in this backlog

**Deployment and backups** — deferred by decision until the application is complete.

**Data import** — no exportable dataset exists behind the current spreadsheet, so no importer is built. Customers are onboarded through US-020 and US-030 like any other.

---

## Where the weight sits

**Phase 3 holds the only XL item in the project** — the IndexedDB outbox — alongside four L items, with every story in it P0 except three. A third of the technical risk is concentrated in one phase, and it is the phase whose failure mode is invisible until a Junior loses a route's worth of collections.

Phases 1 and 2 carry the rest of the P0 weight. Phase 5 has no P0 stories at all.

**If the schedule slips**, compress Phase 5. Dashboards are how the business _sees_ the data, and they can ship incrementally after launch.

**Do not compress Phase 3.** A partial offline implementation is worse than none, because it will appear to work right up until the day it silently loses a route's worth of collections — and by then it is trusted.
