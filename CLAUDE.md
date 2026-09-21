# Rasi

Daily-collection finance application replacing a manual Google Sheet process — 1,000+ customers, 10+ collection lines, multiple sectors. Four roles: Super Admin, Admin, Senior, Junior.

The repo directory is `finance-crm`; the product and the root package are `rasi`.

## State: Phase 0 complete, Phase 1 in progress

The `docs/` set fully specifies the system (16 modules, 16 ADRs, 104 stories). **Phase 0 is complete; Phases 1–6 are all in progress. Every module M01–M16 has code, so what is missing is gaps inside modules rather than whole modules — 39 of 104 stories are `Done`, and [docs/06-delivery/backlog.md](docs/06-delivery/backlog.md) names what each unfinished row is still missing. The recurring blockers are review passes and providers that are not configured (VAPID keys, Firebase). SMTP email and the pg-boss worker **do** work against the development database — `dispatch-emails` has delivered real mail, including a US-003 password reset on 2026-09-21.** What exists:

- `apps/web` — Next.js 16, Tailwind v4, runs on :3000 and proxies `/api` to the API in development; `/sign-in`, `/change-password`, `/home`, and a console shell of thirty screens — customers, accounts, collections (list, detail, pending approvals), cash and day closes, sectors, lines, team, dashboards, five reports, notifications and settings (business, holidays, audit, security) — plus the Junior's offline `/route` app and the design-system preview at `/design-system`. Console pages read data in the browser with `useApiQuery` / `apiWrite` over the contract client
- `apps/api` — NestJS 12 with Better Auth at `/api/auth/*`, the M16 platform in `src/platform/` (validated config, pino logging, error filter, `Database` transaction helper, `/health/*`; no tracing or queue check), M02 access control in `src/access/` (`PolicyGuard`, permissions, nine scope predicates), M13's `AuditWriter` in `src/audit/`, and twenty feature modules covering M01–M16 — see [docs/04-engineering/project-structure.md](docs/04-engineering/project-structure.md) for what each one holds
- `packages/db` — Prisma 7, the full 28-table schema, forty-two applied migrations; every data-dictionary invariant is a database constraint (CHECKs, triggers, partial uniques)
- `packages/domain` — boundary-enforced; holds the pure money maths: M06 working calendar (`CalendarDate`, working-day arithmetic, `toBusinessDate`), schedule generation (BR-04/06/07), variance classification (BR-08), profit apportionment on the running total (BR-18) and `toMoney`. Consumed by M05 accounts, M07 collections, M08 cash and M11 dashboards
- `packages/contracts` — boundary-enforced; the in-house API contract (`route()`, `createApiClient`, shared schemas) and the routes for every module with a screen. **Not ts-rest** — [ADR-0011](docs/02-architecture/adr/0011-in-house-api-contract.md) supersedes that part of ADR-0002
- `packages/ui` — Tailwind v4 tokens and a small component base
- PostgreSQL 17 — one database `rasi_dev`, one schema `public`, shared by development and tests

The web screens are sign-in, forced password change, sector, line and team management, customer onboarding (`apps/api/src/customers/`), and account creation with disbursement (`apps/api/src/accounts/`, ledger postings through `apps/api/src/ledger/ledger.service.ts` only). Mid-term accounts (US-030a) are created active with a catch-up posting. Collections are recorded server-side (`apps/api/src/collections/`: `POST /api/collections` with idempotent replay, completion and ledger posting; `GET /api/route`). Corrections (US-044) are ADJUSTMENT rows approved by someone other than the requester, in `correction.service.ts`; both collections and approved corrections move the account through `account-settlement.ts` only. The console has `/collections` (S-16), `/collections/:id` (S-17) and `/collections/pending-approval` (S-18). The offline engine is built (`apps/web/lib/offline/`: IndexedDB outbox, drain, route cache; `apps/web/app/sw.ts`: Serwist worker scoped to `/route`) with the Junior's S-01 route, S-02 record and S-03 sync screens on it — one page, views by hash (`/route`, `/route#collect/<customerId>`, `/route#sync`) so every view opens offline; do not split them into separate paths. Day close and cash handovers (M08) are in `apps/api/src/cash/`: closing marks unvisited slots MISSED, a collection or approved correction on a closed date reopens it through `DayCloseService.moneyWritten`, and an acknowledged handover posts to the ledger. The console has `/cash` and `/lines/:id/day-closes/:date`; the Junior hands over at `/route#handover`. Scheduled jobs (M14) are in `apps/api/src/jobs/`: pg-boss starts only when `WORKER_ENABLED=true`, in the `pgboss` schema a superuser creates once; job handlers take a `SystemContext` (one organization), not a `RequestContext`. **Tier 2 must never close a day or hand over cash** — `day_close` rows and handovers are not removed by the run-tagged cleanup. Audited writes call `AuditWriter` directly; `test/audit-coverage.e2e-spec.ts` fails for a new write route until it is classified as audited (table and action) or not audited (with a reason). The audit log is `/settings/audit` and an account's history is on its page, both Admin-and-above. Notifications (M10) are in `apps/api/src/notifications/`: raise them only through `EventNotices`, inside the event's transaction; push goes through an outbox drained every minute by the `dispatch-notifications` job, with providers in `packages/notifications`. Offline works only in a production build — Serwist is network-only under `next dev`. **Tier 2 must never record a collection.** **Tier 2 tests must never disburse** — prove ledger writes in Tier 1. Before assuming a module, table or helper exists, read [docs/04-engineering/project-structure.md](docs/04-engineering/project-structure.md) — it is the authoritative gap list, and [docs/06-delivery/backlog.md](docs/06-delivery/backlog.md) is authoritative for story status.

## Commands

Run from the repo root; Turborepo fans out.

```bash
pnpm install
pnpm dev           # web :3000, api :3001
pnpm lint          # ESLint in web/ui, oxlint in api
pnpm check-types   # NOT "typecheck" — this is the real script name
pnpm test          # Vitest in api, web (offline engine), domain and contracts
pnpm format        # Prettier over ts, tsx, md
pnpm --filter api seed   # after `pnpm build`: DRY RUN of the seed dataset; --commit keeps it FOR EVER
pnpm --filter api email:test you@example.com   # after `pnpm build`: one email through the .env SMTP server
```

**The seed is permanent once committed.** It writes collections and ledger rows, which reject DELETE, into the only database. Dry-run it freely; never pass `--commit` without being asked. It refuses to run if "Rasi Seed" already exists.

`pnpm test` runs the Tier 1 suite and the offline engine's Vitest specs; `pnpm --filter api test:e2e` runs the HTTP tier. Both need PostgreSQL running, a `.env` (copy `.env.example`) and migrations applied — the suite refuses to run with pending migrations; apply them with `pnpm --filter @repo/db db:deploy`.

**The offline E2E suite writes permanent rows — the one approved exception to the rules below.** `pnpm --filter offline-e2e test:offline` (needs `pnpm build` for the API first; it builds and starts the web app itself, in Chrome) creates a new "Offline E2E &lt;run id&gt;" organisation each run with disbursed accounts, collections and ledger postings that can never be deleted. The user accepted this on 2026-09-14 so the offline path is proven against the real API. Run it deliberately, not as a reflex, and never extend the exception to another suite. Because of it, **no test may assume an append-only table is globally empty** — count only the rows the test created.

`pnpm --filter offline-e2e test:layout` is the other browser suite in that package, and **writes nothing**: it tests the console's phone and computer layouts (ADR-0016), the US-003 password-reset and forced-change screens, US-006 sign-up, US-092's team screens, S-31's refused-attempts log and S-25's discrepancy report against `pnpm dev`, answering `/api/…` inside the browser. It never signs in, because a real sign-in writes a permanent `LOGIN` audit row — keep it that way. **It is where any screen gets its browser pass**, signed-in ones included: `signedInAs(page, role, answers)` in `layout-tests/fake-api.ts` fakes `/api/me` and whatever else the page reads, so "no dev credentials" is no longer a reason for a screen to go unchecked. It proves the screen, never the rules — RBAC cells stay API tests.

**Tests share the development schema, so never truncate or bulk-delete.** Tier 1 tests run inside `withRollback`; Tier 2 tests tag what they create with `testEmail()` / `testCode()` and clean up with `deleteTestRunData`. **Tier 2 must never write an append-only table** (`collection`, `ledger_*`, `audit_log` reject DELETE) — prove those writes in Tier 1. Public sign-up is disabled: create staff with `test/staff.ts#createTestStaff` and sign in with `signIn`. **Never `DROP SCHEMA`** — the `rasi` role cannot create one again. `packages/db` adds `db:migrate`, `db:deploy`, `db:reset`, `db:generate` and `db:studio`.

Node >=24, pnpm 11.25.0 pinned via `packageManager`. PostgreSQL 17 is installed **natively, no Docker** — one database `rasi_dev`, one schema `public`. Setup, and the rules for writing new database constraints, are in [packages/db/README.md](packages/db/README.md).

**Never install Prisma with `@latest`.** `prisma`'s `latest` dist-tag currently points at an 8.0 release candidate while `@prisma/client`'s points at stable 7.10.0, so the obvious command installs mismatched majors. Both are pinned to exactly `7.10.0`.

## Non-negotiables

These carry money correctness and are blocking review comments. Full reasoning in [docs/04-engineering/coding-guidelines.md](docs/04-engineering/coding-guidelines.md).

1. **No floating point in the money path** — `Decimal` end to end, including the frontend. Amounts cross the API as decimal strings, parsed to `Decimal`, never `Number`.
2. **Money writes and their ledger postings share one transaction** — including the notification row and the enqueued job.
3. **No unscoped queries** — every repository method takes `RequestContext`. No default, no optional parameter.
4. **Collections are never updated or deleted** — corrections insert an `ADJUSTMENT` row.
5. **Business dates come from `toBusinessDate`** in `packages/domain`, the only place a timezone conversion happens.

Out-of-scope rows return `404`, not `403`. Every RBAC matrix cell is an API-level test asserting the real HTTP status — a hidden button is not access control.

## Conventions

**Package names are `@repo/*`** — `@repo/db`, `@repo/domain`, `@repo/contracts`, `@repo/ui`. Not `@rasi/*`.

**`apps/api` is ESM.** Relative imports carry a `.js` extension even from `.ts` files: `import { X } from './x.service.js'`. Omitting it type-checks and fails at runtime. The same applies in `packages/db` and `packages/domain`, which are NodeNext.

**`@repo/ui` is the exception — Bundler resolution, no `.js` specifiers.** Resolution has to match the consumer: `@repo/ui` ships raw TSX compiled by Turbopack, which cannot resolve `./badge.js` to `badge.tsx`. Do not "align" it with the others.

**`apps/api` stays on TypeScript 6.** TypeScript 7 is the native port and ships only the `tsc` executable — no programmatic compiler API, which the Nest CLI needs to build. Raising it type-checks fine and then fails at `nest build`. Revisit when 7.1 restores the API.

**`packages/domain` must stay framework-free** — no Prisma, no NestJS. That is what makes the money maths exhaustively testable, and it does not come back once broken.

**Follow the glossary exactly** ([docs/00-overview/glossary.md](docs/00-overview/glossary.md)). "Account" is the trap: a loan is `AccountLoan`, a bookkeeping account is `ledgerAccount`, and bare `account` means Better Auth's table.

**In `apps/api`, go through the platform** ([M16 as built](docs/01-product/modules/M16-platform.md#as-built)):

- Read configuration from `APP_CONFIG` / `loadConfig()`, never `process.env`.
- Throw an `AppError` subclass (`DomainError`, `NotFoundError`, …) with a stable `code`, never a bare `Error`.
- Reach Prisma through `Database.client` and write through `Database.transaction`. **Never call `$transaction` directly** — in Prisma 7 a nested `$transaction` commits independently and survives the outer rollback.
- Every route carries `@AllowAnonymous()` or `@RequirePermission('…')` — the app refuses to start otherwise. A new route also fails `test/rbac-matrix.e2e-spec.ts` until it is added to `EXPECTED_ACCESS` there, with the permission the RBAC matrix gives it. Permissions live in `src/access/permissions.ts` and a test holds them to `docs/01-product/rbac-matrix.md`; change both together.
- Controllers take `@CurrentContext()` and pass it to repository methods. Repositories filter with `inScope(customerScope(context), where)` and return rows through `foundInScope`, so out-of-scope is a `404` identical to missing ([M02 as built](docs/01-product/modules/M02-access-control.md#as-built)).
- Define every endpoint in `packages/contracts` first; the handler uses `@ContractRoute(route)` and `@ContractInput()`. Responses are parsed through the contract, so undeclared fields are stripped — never bypass it to return extra data.
- Audited writes call `AuditWriter.record(context, entry)` **inside** `Database.transaction`; it refuses to run outside one.
- "Current assignment" is the one in effect on today's business date, not merely `effectiveTo IS NULL`.
- Log with `PinoLogger.info(fields, message)`. A field not in `SAFE_LOG_KEYS` is logged as `[REDACTED]`; adding one is a security decision.
- HTTP tests build the app with `test/app.ts#createTestApp`, never by hand.

**Reference rule IDs in code** — `BR-07`, `ADR-0005`. The decisions are written down; connect code to them.

**Vitest, not Jest.** Test names state behaviour, not method names.

## Frontend and design system

**`@repo/ui` is Tailwind v4 with an owned component base.** Tokens live in `packages/ui/src/theme.css` as a `@theme` block and are the only source of colour, type, radius and elevation — a hard-coded hex value is a review comment. Full guidance in [docs/05-ux/design-system.md](docs/05-ux/design-system.md), decision in [ADR-0010](docs/02-architecture/adr/0010-tailwind-v4-component-base.md).

**Invoke `ecc:design-system`** before changing tokens or adding a component family, and run its audit and slop-check before marking any UI story `Done`.

**Component APIs follow `vercel-composition-patterns`** — explicit variants, never boolean props (`tone="danger"`, not `<Button primary danger>`); no `dense` prop, read the density variables; no `forwardRef` on React 19. **`apps/web` follows `vercel-react-best-practices`** — Server Components by default, with the Junior's route as the documented client-heavy exception.

**`design-taste-frontend` applies as an anti-slop review checklist only.** Its own §13 rules it out for dashboards, data tables and multi-step product UI, which is nearly all of Rasi — do not apply its hero dials or landing-page composition rules to a collections table.

**Icons: `@phosphor-icons/react`, one family, `strokeWidth` 1.5.** Never hand-roll an SVG path.

**Money never becomes a `number` in the UI.** `formatCurrency` takes a decimal string; `toFixed` is banned.

## Docs map

| Need                              | Read                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| What exists vs what doesn't       | [04-engineering/project-structure.md](docs/04-engineering/project-structure.md)                      |
| Domain vocabulary                 | [00-overview/glossary.md](docs/00-overview/glossary.md)                                              |
| Money rules, with worked examples | [01-product/business-rules.md](docs/01-product/business-rules.md)                                    |
| A module's spec                   | `docs/01-product/modules/M01`–`M16`                                                                  |
| Why a decision was made           | [02-architecture/adr/](docs/02-architecture/adr/)                                                    |
| Data model                        | [03-data/erd.md](docs/03-data/erd.md), [03-data/data-dictionary.md](docs/03-data/data-dictionary.md) |
| Tokens, density, components       | [05-ux/design-system.md](docs/05-ux/design-system.md)                                                |
| What to build next                | [06-delivery/roadmap.md](docs/06-delivery/roadmap.md)                                                |

Source of business intent is `docs/reference/Rasi_Application_Product_Documentation_v0.1.pdf`, but where the docs contradict it, **the docs win** — they resolve ambiguities the PDF left open.

## Update the docs when you finish work — always

The docs are the only record of what is built. **Treat a story as unfinished until its docs are updated**, in the same session, without being asked again.

**Before starting**, read [docs/06-delivery/backlog.md](docs/06-delivery/backlog.md) to see what is `Done`, `WIP` and not started. Do not trust memory or an earlier summary — the backlog is authoritative.

**After finishing**, in this order:

1. **[docs/06-delivery/backlog.md](docs/06-delivery/backlog.md)** — set the story's `State` to `Done`, or `WIP` with what remains named in the row. Then fix the progress counts at the top of that file. **This is the single source of truth for story status.**
2. **[docs/04-engineering/project-structure.md](docs/04-engineering/project-structure.md)** — if a package, database, or piece of infrastructure now exists, remove it from the "Not yet present" table and add it to the workspace tree, with its real version.
3. **The module spec** in `docs/01-product/modules/` — if what got built differs from what was specified, fix the spec. Once code ships, the spec is the thing that is wrong.
4. **An [ADR](docs/02-architecture/adr/)** — only if a hard-to-reverse decision was made, or an existing ADR was contradicted. A choice that follows from an existing ADR does not get one.
5. **Phase markers** in [docs/06-delivery/roadmap.md](docs/06-delivery/roadmap.md) and the implementation table in [docs/README.md](docs/README.md) — **at a phase boundary only.** These are coarse summaries.

Rules for this:

- **Status lives in exactly one place.** Per-story in the backlog, per-package in project-structure, per-phase in the roadmap. A document that needs to mention progress links to the backlog instead of restating it.
- **`Done` means the [Definition of Done](docs/04-engineering/definition-of-done.md) passed** — tests written, RBAC cells covered, money logic with its worked-example test. Code that merely exists is `WIP`. Do not mark `Done` on the strength of having written the code.
- **Say what actually happened.** If a story is partly built or a test is skipped, the row says so. A docs set that overstates progress is worse than one that is behind, because decisions get made against it.
- **No git, CI, branch or deployment content in `docs/`.** Hosting and backups are deferred by decision; the docs describe the product and the system, not a pipeline.

## Working on this repo

- **The highest-risk work is offline sync** ([docs/02-architecture/offline-sync.md](docs/02-architecture/offline-sync.md)). A Junior who cannot record a collection at a customer's door has no fallback but paper. It shapes the schema, the API and the day-close model, and cannot be retrofitted.
- **Build in roadmap order.** The sequencing is by risk and dependency, not module number — `packages/domain` before anything that consumes it, offline before the screens that depend on it.
- **Scaffold code is not foundations.** `app.controller.ts`, `app.service.ts` and the starter page get deleted as real modules arrive.
