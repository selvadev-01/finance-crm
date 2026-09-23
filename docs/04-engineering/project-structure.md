# Project Structure — as it stands today

What is actually in the repository right now, as opposed to the target shape described in [`system-architecture.md`](../02-architecture/system-architecture.md#repository-shape).

**Read this before starting work.** The specification set is complete, and every module M01–M16 now has code: `packages/domain` holds the money maths — working calendar, schedule generation, variance classification and profit apportionment — and M05 accounts, M07 collections, M08 cash and M11 dashboards consume it. `apps/api` carries all sixteen modules on the API side and `apps/web` has thirty console screens plus the Junior's offline field app. What is missing is no longer whole modules but the gaps inside them: the [backlog](../06-delivery/backlog.md) is the per-story record and names each one. Infrastructure that does not exist at all is in [Not yet present](#not-yet-present) below.

---

## Workspace layout

```
rasi/
├─ apps/
│  ├─ api/               NestJS 12 — M16 platform (nestjs-pino 5.1.0, pino 10.3.1, zod 4.6.2), M02 access control, M13 audit writer, M03 organisation, M06 declared holidays with schedule shifting (src/calendar), M01 staff directory, password reset — Admin-initiated in src/identity, self-service through Better Auth's token in src/auth/password-reset.ts (US-003) — and staff administration (create, update, role change, suspend and reactivate, with the rank and self-action rules in src/identity/staff-admin.service.ts), M04 customer and M05 account endpoints, M07 collection recording, route, history and corrections with approvals, M08 day close, reopen, MISSED marking and cash handovers with denominations (src/cash), M09 LedgerService (disbursement, mid-term catch-up, collection, adjustment and handover postings) and ReconciliationService, M13 audit reads (src/audit: audit log and account history, with a test holding every write route to an audit decision) and the M13 security log (src/security: `SecurityEventRecorder` for refused attempts, its refusal registry and the read side, [ADR-0014](../02-architecture/adr/0014-security-event-log.md)), M10 notifications (src/notifications: centre, preferences, device registration, event notices raised in their transactions, outbox dispatch), M11 Admin operational and Senior line dashboards (src/dashboards, reading BR-16's per-line figures from src/cash/line-day-figures.ts, shared with the day close; the dashboards' trend in src/dashboards/dashboard-trend.service.ts over `lineDailyFigures`), M12 line-wise report, investment overview, collection report, overdue report and discrepancy report (src/reports, the same readers over a date range, with the ledger's position and movement, BR-08's classification breakdown and BR-16's per-account arrears in src/dashboards/business-figures.ts, and BR-17's per-Junior cash in src/cash/line-day-figures.ts; the overdue report is range-less, and it and the discrepancy report are cursor-paged), M12 Excel and PDF export of the reports, dashboards and collection list (src/exports: one document model drawn by exceljs 4.4.0 and pdfkit 0.17.2, every export recorded as an EXPORT audit entry), M14 jobs (pg-boss 12.32.0 in the pgboss schema, WORKER_ENABLED mode, reconcile / overdue / key-purge / every-minute notification and email dispatch schedules — **run against the development database**: as of 2026-09-21 `pgboss.job` holds thousands of completed runs of each schedule, and `dispatch-emails` has delivered real mail through SMTP), M15 business settings (src/settings: a code-owned registry of defaults with the `setting` table holding overrides only, and every setting classified free / forward-only / locked so a change that would restate history is refused by the API), seed dataset (src/seed, dry run by default), Better Auth, /health/*
│  ├─ web/               Next.js 16 App Router — /sign-in, /change-password, /forgot-password and /reset-password (US-003 self-service), /home role redirect; console shell (@phosphor-icons/react 2.1.10) with /dashboard (S-20 for Admins and Super Admins, US-082; S-19 for Seniors, US-083), /customers list + onboarding form + profile (US-020), /accounts/new with live schedule preview and /accounts/:id with disbursement (US-030, US-032), /sectors and /lines list + detail (S-12, S-13), /team list + detail with add-staff, edit, role-change, suspend and reactivate dialogs beside assign and password reset (S-14, S-15, US-003, US-092), /collections list, detail and pending approvals (S-16, S-17, S-18, US-044), /cash and /lines/:id/day-closes/:date (S-05, S-06 for Seniors and Admins), /reports index with /reports/line-wise (S-22, US-084), /reports/investment (US-085), /reports/collection (US-086), /reports/overdue (S-24, US-087, cursor-paged) and /reports/discrepancy (S-25, BR-17, cursor-paged) on a shared reports/report-parts.tsx (Admins and Seniors), Settings as one sidebar item whose parts are tabs (lib/settings-tabs.ts decides which a role sees; /settings opens the first of them) — /settings/business (S-28, Super Admin only, US-094), /settings/holidays (S-27, every console role; changes for Admins), /settings/notifications (this device's push and the reader's categories, US-071 and US-073), /settings/audit (S-29) and /settings/security (S-31, refused attempts) for Admins, beside the account page's history (US-091); /profile (S-32, the reader's own record, password and device) from the account menu; S-21, the notification centre, as the panel the shell's bell opens — a popover on a computer, a sheet on a phone, no page of its own — with public/push-sw.js (push-only, scope /push/); /design-system preview. The console is built from `@repo/ui` and from apps/web/components/ (the status-badge registry, column builders, list and record fallbacks, page trail, line filter, customer-picker.tsx — the server-searched existing-customer choice S-10's reference persons copy from — money display, the settings tab strip in tab-links.tsx), with lib/use-paged-query.ts (numbered pages over the API's cursors, ten a page, in the URL — ADR-0017) beside lib/use-infinite-query.ts (the scrolling list the notification panel and the field app keep) and components/pager.tsx, lib/use-list-state.ts (filters in the URL), lib/money.ts (paise arithmetic), lib/format.ts and lib/form-errors.ts. Console data is read in the browser through the contract client. /route is the Junior's field app, a native-style four-tab app since 2026-09-21 (app/route/app-chrome.tsx: top app bar with sync chip and bell, bottom navigation, banners, snackbar) — tabs Route (J-01), Collections (#collections, J-03), Cash (#handover, J-05, needs signal) and Profile (#profile, J-08); over them record (#collect/:customerId, J-02), sync (#sync, J-04), ask for a correction (#correct, J-06, needs signal) and notifications (#notifications, J-07, needs signal), all hash views of one page (app/route/hash-view.ts) — on the offline engine: lib/offline/ (idb 8.0.3 outbox and drain) and app/sw.ts (serwist 9.5.12, @serwist/turbopack 9.5.12 with esbuild 0.28.2, served at /serwist/sw.js, scope /route)
│  └─ offline-e2e/       Playwright 1.63.0 in Chrome. tests/ — against a production web build and the real API: offline record, sync, replay, 401, restart. WRITES PERMANENT ROWS (an "Offline E2E" organisation per run). regression/ — the Super Admin → Admin → Senior → Junior journey through the real screens and API in one business day, with Chennai data (regression/data.ts: Chennai North/South sectors, area lines, Tamil names, ten-digit mobiles): the bootstrap owner appoints the Admin, staff creation and forced password change at each step, sectors, lines, assignments, customers, disbursed and mid-term accounts, the Junior's route, collections, a correction approved by the Senior, cash handover and day close, then the books read back from the database. Reuses a running `pnpm dev` if one is up. ALSO WRITES PERMANENT ROWS (a "Sri Kamakshi Finance — Regression" organisation per run; the exception extended 2026-09-22). layout-tests/ — against `next dev` with every /api/… answered in the browser, so it WRITES NOTHING and never signs in: the console's two layouts (ADR-0016), the US-003 password-reset and forced-change screens, US-006 sign-up with a business's own sign-in link, US-092's team list and staff page, S-31's refused-attempts log, S-25's discrepancy report, S-10's reference person picker (customer-reference-picker.spec.ts) and the US-003 temporary-password dialog, each at 360/768/1280. `signedInAs(page, role, answers)` fakes `/api/me` and any other route a screen reads, so a signed-in console page can be checked without a real sign-in writing a `LOGIN` row
├─ packages/
│  ├─ contracts/         @repo/contracts — Zod 4.6.2; in-house route contract and fetch client (ADR-0011), M03 routes, M11 dashboard and M12 report routes
│  ├─ db/                @repo/db — Prisma 7.10.0, schema, migrations, client
│  ├─ notifications/     @repo/notifications — push provider interface, WebPushProvider (web-push 3.6.7), FcmProvider (firebase-admin 14.4.0), SmtpEmailProvider (nodemailer 10.0.10), delivery outcome and retry table
│  ├─ domain/            @repo/domain — working calendar (M06), schedule generation (BR-04/06/07) at three collection frequencies (src/schedule/frequency.ts: daily, weekly and monthly due dates, the last two anchored in calendar time from day 0 so a holiday moves one visit and not the cadence) and the holiday shift (BR-02, which follows the frequency), variance classification (BR-08), profit apportionment (BR-18); decimal.js 10.6.0, date-fns 4.4.0, @date-fns/tz 1.5.0, fast-check 4.10.0 (dev)
│  ├─ ui/                @repo/ui — Tailwind v4 "soft teal" theme (ADR-0013); base (Button, Badge, empty states, Input, Field, FormMessage, Select, Textarea, Dialog); Radix building blocks (Checkbox, Switch, Choice, Combobox on cmdk, Tabs, Popover, Menu, Tooltip, Toast); layout (AppShell, PageHeader, Section, Card, StatGrid/Stat, DescriptionList, Breadcrumbs, skeletons); DataView on TanStack Table with FilterBar, ListPager (ADR-0017) and ListFooter; form layer on react-hook-form (Form, FormField, FormControlField, DialogForm); jsdom test suite with a WCAG contrast test
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

| Script                                      | What it does                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                  | `web` on :3000 and `api` on :3001, both watching                                                               |
| `pnpm build`                                | `next build` + `nest build`, topologically ordered                                                             |
| `pnpm lint`                                 | ESLint in web/ui, oxlint in api                                                                                |
| `pnpm check-types`                          | `tsc --noEmit` across the workspace                                                                            |
| `pnpm test`                                 | Vitest in api, web (offline engine and lib helpers), ui (components and contrast, jsdom), domain and contracts |
| `pnpm --filter offline-e2e test:offline`    | Builds web, starts the built API and web, runs the offline Playwright suite — permanent rows                   |
| `pnpm --filter offline-e2e test:regression` | The Admin → Senior → Junior journey in Chrome against the real API — permanent rows                            |
| `pnpm format`                               | Prettier write across `ts`, `tsx`, `md`                                                                        |

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

Everything in this list is specified but unbuilt. The [roadmap](../06-delivery/roadmap.md) sequences it; Phase 0 is complete and Phases 1–6 are in progress.

**This table is maintained.** When one of these lands, delete its row and add it to the workspace tree above with its real version. Per-story progress is not tracked here — it lives in [`backlog.md`](../06-delivery/backlog.md), and a module that exists but is incomplete belongs there, not in this table.

| Missing                                                                          | Specified in                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| OpenAPI generated from the contract, served at `/api/docs`                       | [ADR-0011](../02-architecture/adr/0011-in-house-api-contract.md) |
| Tracing — OpenTelemetry and Sentry, deferred until there is a deployment to wire | [M16](../01-product/modules/M16-platform.md)                     |
| The job-queue readiness check in `/health/ready`                                 | [M16](../01-product/modules/M16-platform.md)                     |

The `/design-system` preview in `apps/web` is a canary, not a product screen; the landing placeholders are replaced as each role's real screen lands.

---

## Local setup

```bash
pnpm install
pnpm dev          # web :3000, api :3001
```

PostgreSQL is **installed natively, no Docker** ([system-architecture](../02-architecture/system-architecture.md#runtime)). Installed version is **17.7**, not the 16 named in system-architecture.

**One database, one schema.** `rasi_dev` holds everything in `public`, and development and the test suite share it through a single `DATABASE_URL`. Neither the separately-specified `rasi_test` database nor the later `test` schema exists. Because tests share development data, the harness never truncates: service tests roll back, and HTTP tests delete only the rows tagged with their own run ([backlog](../06-delivery/backlog.md#phase-0--foundations)). The suite refuses to run with pending migrations rather than applying them. Setup steps are in [`packages/db/README.md`](../../packages/db/README.md).

**Forty-four migrations**:

- `add_better_auth` and `rasi_core`.
- Twenty `constraints_*` migrations holding CHECKs, triggers and partial unique indexes; `constraints_collection_corrections` (US-044) specifies the collection status transitions and allows one pending correction per collection.
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
- `audit_export` and `constraints_audit_export` (M12): the `EXPORT` audit action, recording who took which figures out of the system and with which filters.
- `customer_handover_events` and `account_overdue_event` (M10's last three catalogue entries: `NEW_CUSTOMER`, `HANDOVER_ACKNOWLEDGED`, `ACCOUNT_OVERDUE`), each alone for the enum rule.
- `password_reset_email` adds the `PASSWORD_RESET` email kind, queued by the self-service reset (US-003, built 2026-09-20).
- `customer_route_position` and `constraints_customer_route_position` (US-040, 2026-09-21): a customer's place on its line's visiting order, one customer per place, counted from 1.

The generator enables Prisma's `partialIndexes` preview feature. Specs proving each constraint are in `apps/api/test/db-constraints/`.

`.env.example` exists at the repository root. `apps/api` validates every variable at startup and refuses to boot, listing every problem, if one is missing or malformed; `apps/api/src/platform/config/config.ts` is its only reader of `process.env` ([M16](../01-product/modules/M16-platform.md#as-built)). `apps/api` does not load `.env` itself — the environment must provide the variables.

### Prisma 7 differs from most Prisma documentation

Two changes that invalidate examples written before v7, and that no specification in `docs/` anticipates:

- **`url` is gone from the `datasource` block.** The connection string for migration and introspection commands lives in `packages/db/prisma7.config.ts`, which loads the root `.env` explicitly — `dotenv` resolves relative to the working directory, which is `packages/db` when the CLI runs.
- **The runtime client takes a driver adapter**, not a connection string: `@prisma/adapter-pg`. The client is constructed lazily, so importing `@repo/db` neither connects nor requires `DATABASE_URL` until something uses it. That is what lets the Better Auth CLI load `auth.config.ts` before a database exists.

`prisma` and `@prisma/client` are pinned to exactly `7.10.0`. **Do not install either with `@latest`** — at the time of writing `prisma`'s `latest` dist-tag points at `8.0.0-rc.14` while `@prisma/client`'s points at stable `7.10.0`, so the obvious command installs mismatched majors, one of them a release candidate.
