# Rasi

Daily-collection finance application replacing a manual Google Sheet process — 1,000+ customers, 10+ collection lines, multiple sectors. Four roles: Super Admin, Admin, Senior, Junior.

The repo directory is `finance-crm`; the product and the root package are `rasi`.

## State: Phase 0 complete, no product modules built

The `docs/` set fully specifies the system (16 modules, 10 ADRs, 97 stories). **Phase 0 foundations are done; none of M01–M16 is built.** What exists:

- `apps/web` — Next.js 16, Tailwind v4, a design-system preview at `/`, runs on :3000 and proxies `/api` to the API in development
- `apps/api` — NestJS 12 with Better Auth mounted at `/api/auth/*`; the create-nest-app scaffold has been deleted
- `packages/db` — Prisma 7, the full 28-table schema, two applied migrations
- `packages/domain`, `packages/contracts` — created and boundary-enforced, deliberately empty until Phase 1
- `packages/ui` — Tailwind v4 tokens and a small component base
- PostgreSQL 17 — one database `rasi_dev`, `public` for development and `test` for the harness

No domain logic, no scoping layer, no M01–M16. Before assuming a module, table or helper exists, read [docs/04-engineering/project-structure.md](docs/04-engineering/project-structure.md) — it is the authoritative gap list, and [docs/06-delivery/backlog.md](docs/06-delivery/backlog.md) is authoritative for story status.

## Commands

Run from the repo root; Turborepo fans out.

```bash
pnpm install
pnpm dev           # web :3000, api :3001
pnpm lint          # ESLint in web/ui, oxlint in api
pnpm check-types   # NOT "typecheck" — this is the real script name
pnpm test          # Vitest in api; nothing else has tests yet
pnpm format        # Prettier over ts, tsx, md
```

`pnpm test` runs the Tier 1 suite; `pnpm --filter api test:e2e` runs the HTTP tier. Both need PostgreSQL running and a `.env` — copy `.env.example`. `packages/db` adds `db:migrate`, `db:deploy`, `db:reset`, `db:generate` and `db:studio`.

Node >=24, pnpm 11.25.0 pinned via `packageManager`. PostgreSQL 17 is installed **natively, no Docker** — one database `rasi_dev`, with `public` for development and `test` owned by the harness. Setup is in [packages/db/README.md](packages/db/README.md).

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
