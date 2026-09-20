# Project Structure — as it stands today

What is actually in the repository right now, as opposed to the target shape described in [`system-architecture.md`](../02-architecture/system-architecture.md#repository-shape).

**Read this before starting work.** The specification set is complete; the code is a Turborepo scaffold with two runnable apps, and `packages/domain` holds the Phase 1 money maths — working calendar, schedule generation, variance classification and profit apportionment — but nothing consumes it yet. In `apps/api`, M16 Platform, M02 Access Control, M13 Audit and M03 Organisation are partly built (API only); the other modules are unimplemented.

---

## Workspace layout

```
rasi/
├─ apps/
│  ├─ api/               NestJS 12 — M16 platform (nestjs-pino 5.1.0, pino 10.3.1, zod 4.6.2), M02 access control, M13 audit writer, M03 organisation, M06 declared holidays with schedule shifting (src/calendar), M01 staff directory, password reset and staff administration (create, update, role change, suspend and reactivate, with the rank and self-action rules in src/identity/staff-admin.service.ts), M04 customer and M05 account endpoints, M07 collection recording, route, history and corrections with approvals, M08 day close, reopen, MISSED marking and cash handovers with denominations (src/cash), M09 LedgerService (disbursement, mid-term catch-up, collection, adjustment and handover postings) and ReconciliationService, M13 audit reads (src/audit: audit log and account history, with a test holding every write route to an audit decision) and the M13 security log (src/security: `SecurityEventRecorder` for refused attempts, its refusal registry and the read side, [ADR-0014](../02-architecture/adr/0014-security-event-log.md)), M10 notifications (src/notifications: centre, preferences, device registration, event notices raised in their transactions, outbox dispatch), M11 Admin operational and Senior line dashboards (src/dashboards, reading BR-16's per-line figures from src/cash/line-day-figures.ts, shared with the day close; the dashboards' trend in src/dashboards/dashboard-trend.service.ts over `lineDailyFigures`), M12 line-wise report, investment overview, collection report, overdue report and discrepancy report (src/reports, the same readers over a date range, with the ledger's position and movement, BR-08's classification breakdown and BR-16's per-account arrears in src/dashboards/business-figures.ts, and BR-17's per-Junior cash in src/cash/line-day-figures.ts; the overdue report is range-less, and it and the discrepancy report are cursor-paged), M12 Excel and PDF export of the reports, dashboards and collection list (src/exports: one document model drawn by exceljs 4.4.0 and pdfkit 0.17.2, every export recorded as an EXPORT audit entry), M14 jobs (pg-boss 12.32.0 in the pgboss schema, WORKER_ENABLED mode, reconcile / overdue / key-purge / every-minute notification dispatch schedules — not yet run against the database), M15 business settings (src/settings: a code-owned registry of defaults with the `setting` table holding overrides only, and every setting classified free / forward-only / locked so a change that would restate history is refused by the API), seed dataset (src/seed, dry run by default), Better Auth, /health/*
│  ├─ web/               Next.js 16 App Router — /sign-in, /change-password, /home role redirect; console shell (@phosphor-icons/react 2.1.10) with /dashboard (S-20 for Admins and Super Admins, US-082; S-19 for Seniors, US-083), /customers list + onboarding form + profile (US-020), /accounts/new with live schedule preview and /accounts/:id with disbursement (US-030, US-032), /sectors and /lines list + detail (S-12, S-13), /team list + detail with add-staff, edit, role-change, suspend and reactivate dialogs beside assign and password reset (S-14, S-15, US-003, US-092), /collections list, detail and pending approvals (S-16, S-17, S-18, US-044), /cash and /lines/:id/day-closes/:date (S-05, S-06 for Seniors and Admins), /reports index with /reports/line-wise (S-22, US-084), /reports/investment (US-085), /reports/collection (US-086), /reports/overdue (S-24, US-087, cursor-paged) and /reports/discrepancy (S-25, BR-17, cursor-paged) on a shared reports/report-parts.tsx (Admins and Seniors), /settings/holidays (S-27, every console role; changes for Admins), /settings/audit (S-29), /settings/security (S-31, refused attempts) and the account page's history (US-091) for Admins, /settings (S-28, business settings, Super Admin only, US-094), /notifications (S-21) with the bell in the shell and public/push-sw.js (push-only, scope /push/); /design-system preview. The console is built from `@repo/ui` and from apps/web/components/ (the status-badge registry, column builders, list and record fallbacks, page trail, line filter, money display), with lib/use-paged-query.ts (cursor pages), lib/use-list-state.ts (filters in the URL), lib/money.ts (paise arithmetic), lib/format.ts and lib/form-errors.ts. Console data is read in the browser through the contract client. /route is the Junior's field app — S-01 route, S-02 record (#collect/:customerId), S-03 sync (#sync), S-06 hand over cash (#handover, needs signal), S-21 notifications (#notifications, needs signal) as hash views of one page — on the offline engine: lib/offline/ (idb 8.0.3 outbox and drain) and app/sw.ts (serwist 9.5.12, @serwist/turbopack 9.5.12 with esbuild 0.28.2, served at /serwist/sw.js, scope /route)
│  └─ offline-e2e/       Playwright 1.63.0 in Chrome against a production web build and the real API — offline record, sync, replay, 401, restart. WRITES PERMANENT ROWS (an "Offline E2E" organisation per run)
├─ packages/
│  ├─ contracts/         @repo/contracts — Zod 4.6.2; in-house route contract and fetch client (ADR-0011), M03 routes, M11 dashboard and M12 report routes
│  ├─ db/                @repo/db — Prisma 7.10.0, schema, migrations, client
│  ├─ notifications/     @repo/notifications — push provider interface, WebPushProvider (web-push 3.6.7), FcmProvider (firebase-admin 14.4.0), SmtpEmailProvider (nodemailer 10.0.10), delivery outcome and retry table
│  ├─ domain/            @repo/domain — working calendar (M06), schedule generation (BR-04/06/07) and the holiday shift (BR-02), variance classification (BR-08), profit apportionment (BR-18); decimal.js 10.6.0, date-fns 4.4.0, @date-fns/tz 1.5.0, fast-check 4.10.0 (dev)
│  ├─ ui/                @repo/ui — Tailwind v4 "soft teal" theme (ADR-0013); base (Button, Badge, empty states, Input, Field, FormMessage, Select, Textarea, Dialog); Radix building blocks (Checkbox, Switch, Choice, Combobox on cmdk, Tabs, Popover, Menu, Tooltip, Toast); layout (AppShell, PageHeader, Section, Card, StatGrid/Stat, DescriptionList, Breadcrumbs, skeletons); DataView on TanStack Table with FilterBar/ListFooter; form layer on react-hook-form (Form, FormField, FormControlField, DialogForm); jsdom test suite with a WCAG contrast test
│  ├─ eslint-config/     @repo/eslint-config — base, boundaries, next, react-internal
│  └─ typescript-config/ @repo/typescript-config — base, nextjs, react-library
└─ docs/                 this specification set
```

`pnpm-workspace.yaml` globs `apps/*` and `packages/*`, so a new package is picked up by creating the directory.

**Package names are `@repo/*`, not `@rasi/*`.** This is the Turborepo starter convention the repository was created with, and the docs follow it. Keep it consistent when adding packages — `@repo/db`, `@repo/domain`, `@repo/contracts`.

---

## Toolchain

| Tool       | Version                                  | Notes                                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------------- |
| Node       | `>=24`                                   | Enforced by `engines` in the root `package.json`          |
| pnpm       | `11.25.0`                                | Pinned via `packageManager`                               |
| Turborepo  | `2.10.x`                                 | Task graph in `turbo.json`, TUI enabled                   |
| TypeScript | `7.0.2` (root, web, ui) · `^6.0.2` (api) | **The api must stay on 6 — do not "align" it.** See below |
| Prettier   | `3.9.6`                                  | Root `format` script, over `**/*.{ts,tsx,md}`             |

### Per app

|               | `apps/web`                                                                             | `apps/api`                                         |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Framework     | Next.js `16.3.4`, React `19.2.8`                                                       | NestJS `12`, Express platform                      |
| Module system | ESM                                                                                    | ESM (`"type": "module"`)                           |
| Lint          | ESLint `10` flat config, `--max-warnings 0`                                            | oxlint `1.58` over `src/` and `test/`              |
| Tests         | Vitest `4` + fake-indexeddb `6.2.5` (offline engine); Playwright in `apps/offline-e2e` | Vitest `4` — unit + Tier 1, and an HTTP e2e config |
| Styling       | `globals.css` + CSS Modules                                                            | —                                                  |
| Dev port      | `3000`                                                                                 | `3001` (`PORT` env overrides)                      |

**`apps/api` is pinned to TypeScript 6 deliberately.** TypeScript 7.0 is the native port and ships the `tsc` executable only — it does not expose the programmatic compiler API, which the Nest CLI needs to build. Raising the api to `7.0.2` type-checks fine (`check-types` is plain `tsc --noEmit`) and then fails at `nest build` with _"The installed TypeScript version does not expose the programmatic compiler API"_. The API is expected back in TypeScript 7.1; until then the api stays on `^6.0.2` and the version split is correct, not technical debt.

**Tailwind v4 with an owned component base.** Tokens live in `packages/ui/src/theme.css` as a `@theme` block — v4 has no `presets` mechanism, so the shared layer is CSS rather than a JS config. See [design-system.md](../05-ux/design-system.md), [ADR-0010](../02-architecture/adr/0010-tailwind-v4-component-base.md) and [ADR-0013](../02-architecture/adr/0013-console-re-theme-and-headless-libraries.md).

**IBM Plex Sans and Mono via `next/font/google`** (Next `16.3.4`), declared in `apps/web/app/layout.tsx` with `preload: false`; the field app opts out with `data-font="system"`.

**`@repo/ui` has a component test suite:** Vitest `4` in jsdom `30.0.1`, `@testing-library/react` `16.3.3`, `@testing-library/dom` `10.4.2`, `@testing-library/jest-dom` `7.0.1` and `@testing-library/user-event` `14.6.7`, configured in `packages/ui/vitest.config.mts`. `@repo/ui` depends on `radix-ui` `1.6.7`, `cmdk` `1.1.1`, `@tanstack/react-table` `8.21.3`, `react-hook-form` `7.88.0`, `@hookform/resolvers` `5.9.1` and `zod` `4.6.2` — the same zod as `@repo/contracts`, so the workspace resolves one copy (ADR-0013). `apps/web` depends on `react-hook-form` `7.88.0` for its form-error helper. `@repo/ui` exports `./field-message` separately, a framework-free module the web app's Node tests can import. **There is no chart library** (ADR-0015): the dashboards' `AreaChart` is hand-drawn SVG in `@repo/ui`, with money turned into plot fractions only in `packages/ui/src/chart-scale.ts`.

**`@repo/ui` uses Bundler module resolution; `@repo/db` and `@repo/domain` use NodeNext.** This is deliberate and must not be "aligned" — resolution has to match the consumer. `@repo/ui` ships raw TSX compiled by Turbopack, which cannot resolve the `.js` specifiers NodeNext requires; the others are compiled and run by Node, which needs them.

**Vitest, not Jest**, in `apps/api` — including `test:e2e` via `vitest.config.e2e.ts` with supertest — and in `packages/domain`, where specs sit beside the source as `*.spec.ts`. Its `build` uses `tsconfig.build.json` to keep them out of `dist`, while `check-types` still covers them.

---

## Scripts

Run from the repository root; Turborepo fans them out.

| Script                                   | What it does                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                               | `web` on :3000 and `api` on :3001, both watching                                                               |
| `pnpm build`                             | `next build` + `nest build`, topologically ordered                                                             |
| `pnpm lint`                              | ESLint in web/ui, oxlint in api                                                                                |
| `pnpm check-types`                       | `tsc --noEmit` across the workspace                                                                            |
| `pnpm test`                              | Vitest in api, web (offline engine and lib helpers), ui (components and contrast, jsdom), domain and contracts |
| `pnpm --filter offline-e2e test:offline` | Builds web, starts the built API and web, runs the offline Playwright suite — permanent rows                   |
| `pnpm format`                            | Prettier write across `ts`, `tsx`, `md`                                                                        |

`packages/db` adds its own, run with `pnpm --filter @repo/db <script>`:

| Script        | What it does                                            |
| ------------- | ------------------------------------------------------- |
| `db:generate` | Regenerate the Prisma client into `src/generated`       |
| `db:migrate`  | `prisma migrate dev` — author and apply a new migration |
| `db:deploy`   | `prisma migrate deploy` — apply existing migrations     |
| `db:reset`    | Drop, recreate and re-apply every migration             |
| `db:studio`   | Prisma Studio                                           |

Its `build` is `prisma generate && tsc`, so `apps/api` cannot compile until `@repo/db` has been built at least once. Turborepo's `^build` dependency handles that.

**The type-check script is `check-types`, not `typecheck`.** Turborepo's task name and the per-package script name have to match, so use the existing name rather than adding a second one.

---

## ESM in `apps/api`

`apps/api` is ESM, which the default NestJS templates are not. Two consequences that bite immediately:

```ts
// ✓ relative imports carry the .js extension, even from .ts files
import { AppService } from "./app.service.js";

// ✗ resolves in the editor, fails at runtime
import { AppService } from "./app.service";
```

Top-level `await` is available and already used in `apps/api/src/main.ts` — `await bootstrap()` rather than a floating promise.

---

## Not yet present

Everything in this list is specified but unbuilt. The [roadmap](../06-delivery/roadmap.md) sequences it, starting with the rest of Phase 0.

**This table is maintained.** When one of these lands, delete its row and add it to the workspace tree above with its real version. Per-story progress is not tracked here — it lives in [`backlog.md`](../06-delivery/backlog.md).

| Missing                                                          | Specified in                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| The 24 Rasi models — only Better Auth's four tables exist so far | [data-dictionary.md](../03-data/data-dictionary.md)              |
| OpenAPI generated from the contract, served at `/api/docs`       | [ADR-0011](../02-architecture/adr/0011-in-house-api-contract.md) |
| Scope predicates beyond customers and collections                | [M02](../01-product/modules/M02-access-control.md)               |
| Any of M01–M16                                                   | [prd.md](../01-product/prd.md)                                   |

The `/design-system` preview in `apps/web` is a canary, not a product screen; the landing placeholders are replaced as each role's real screen lands.

---

## Local setup

```bash
pnpm install
pnpm dev          # web :3000, api :3001
```

PostgreSQL is **installed natively, no Docker** ([system-architecture](../02-architecture/system-architecture.md#runtime)). Installed version is **17.7**, not the 16 named in system-architecture.

**One database, one schema.** `rasi_dev` holds everything in `public`, and development and the test suite share it through a single `DATABASE_URL`. Neither the separately-specified `rasi_test` database nor the later `test` schema exists. Because tests share development data, the harness never truncates: service tests roll back, and HTTP tests delete only the rows tagged with their own run ([backlog](../06-delivery/backlog.md#phase-0--foundations)). The suite refuses to run with pending migrations rather than applying them. Setup steps are in [`packages/db/README.md`](../../packages/db/README.md).

**Thirty-nine migrations**:

- `add_better_auth` and `rasi_core`.
- Fourteen `constraints_*` migrations holding CHECKs, triggers and partial unique indexes; `constraints_collection_corrections` (US-044) specifies the collection status transitions and allows one pending correction per collection.
- `staff_must_change_password` (US-003).
- `customer_code_sequence` (US-020).
- `customer_line_period` (US-023), with the backfill giving every existing customer one open period.
- `ledger_account_organization` and `account_code_sequence` (US-030, US-032).
- `collection_status_rejected` (US-044) and `ledger_write_off_loss` (US-035), each alone because PostgreSQL cannot use a new enum value in the transaction that adds it; `constraints_ledger_write_off_loss` then makes the new ledger account debit-normal and one per organization.
- `day_close_handovers` and `cash_handover_note` (M08): the handover's hop and note, and `device_sync_report`; with `constraints_day_close` and `constraints_cash_handover_note`.
- `notification_events` (M10's new event values, alone for the enum rule), `notification_preference`, and `constraints_notifications` (ALERT always on, non-blank title and body, a FAILED delivery has its error).
- `audit_log_organization` and `constraints_audit_log_organization` (US-090): each audit entry names its organization; new rows must, except sign-ins.
- `organization_scoped_uniques`, `organization_slug` and `constraints_organization_slug` (ADR-0012); `email_outbox` and `constraints_email_outbox` (M10); `holiday_events` and `constraints_holiday` (US-093).
- `security_event` and `constraints_security_event` ([ADR-0014](../02-architecture/adr/0014-security-event-log.md)): the refused attempts. Shaped by CHECKs — a 4xx status, a known method, a route pattern, a non-blank code, and a target table only alongside a target id — and deliberately **without** an append-only trigger, unlike `audit_log`.

The generator enables Prisma's `partialIndexes` preview feature. Specs proving each constraint are in `apps/api/test/db-constraints/`.

`.env.example` exists at the repository root. `apps/api` validates every variable at startup and refuses to boot, listing every problem, if one is missing or malformed; `apps/api/src/platform/config/config.ts` is its only reader of `process.env` ([M16](../01-product/modules/M16-platform.md#as-built)). `apps/api` does not load `.env` itself — the environment must provide the variables.

### Prisma 7 differs from most Prisma documentation

Two changes that invalidate examples written before v7, and that no specification in `docs/` anticipates:

- **`url` is gone from the `datasource` block.** The connection string for migration and introspection commands lives in `packages/db/prisma7.config.ts`, which loads the root `.env` explicitly — `dotenv` resolves relative to the working directory, which is `packages/db` when the CLI runs.
- **The runtime client takes a driver adapter**, not a connection string: `@prisma/adapter-pg`. The client is constructed lazily, so importing `@repo/db` neither connects nor requires `DATABASE_URL` until something uses it. That is what lets the Better Auth CLI load `auth.config.ts` before a database exists.

`prisma` and `@prisma/client` are pinned to exactly `7.10.0`. **Do not install either with `@latest`** — at the time of writing `prisma`'s `latest` dist-tag points at `8.0.0-rc.14` while `@prisma/client`'s points at stable `7.10.0`, so the obvious command installs mismatched majors, one of them a release candidate.
