# Project Structure — as it stands today

What is actually in the repository right now, as opposed to the target shape described in [`system-architecture.md`](../02-architecture/system-architecture.md#repository-shape).

**Read this before starting work.** The specification set is complete; the code is a Turborepo scaffold with two runnable apps and no domain logic. Every module spec (M01–M16) is still unimplemented.

---

## Workspace layout

```
rasi/
├─ apps/
│  ├─ api/               NestJS 12 — scaffold only (AppController / AppService)
│  └─ web/               Next.js 16 App Router — starter page only
├─ packages/
│  ├─ contracts/         @repo/contracts — Zod 4.6.2, empty until the first endpoint
│  ├─ db/                @repo/db — Prisma 7.10.0, schema, migrations, client
│  ├─ domain/            @repo/domain — decimal.js + date-fns, empty until M06
│  ├─ ui/                @repo/ui — Tailwind v4 theme, Button, Badge, empty states
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

|               | `apps/web`                                  | `apps/api`                             |
| ------------- | ------------------------------------------- | -------------------------------------- |
| Framework     | Next.js `16.3.4`, React `19.2.8`            | NestJS `12`, Express platform          |
| Module system | ESM                                         | ESM (`"type": "module"`)               |
| Lint          | ESLint `10` flat config, `--max-warnings 0` | oxlint `1.58` over `src/` and `test/`  |
| Tests         | none yet                                    | Vitest `4`, plus a separate e2e config |
| Styling       | `globals.css` + CSS Modules                 | —                                      |
| Dev port      | `3000`                                      | `3001` (`PORT` env overrides)          |

**`apps/api` is pinned to TypeScript 6 deliberately.** TypeScript 7.0 is the native port and ships the `tsc` executable only — it does not expose the programmatic compiler API, which the Nest CLI needs to build. Raising the api to `7.0.2` type-checks fine (`check-types` is plain `tsc --noEmit`) and then fails at `nest build` with _"The installed TypeScript version does not expose the programmatic compiler API"_. The API is expected back in TypeScript 7.1; until then the api stays on `^6.0.2` and the version split is correct, not technical debt.

**Tailwind v4 with an owned component base.** Tokens live in `packages/ui/src/theme.css` as a `@theme` block — v4 has no `presets` mechanism, so the shared layer is CSS rather than a JS config. See [design-system.md](../05-ux/design-system.md) and [ADR-0010](../02-architecture/adr/0010-tailwind-v4-component-base.md).

**`@repo/ui` uses Bundler module resolution; `@repo/db` and `@repo/domain` use NodeNext.** This is deliberate and must not be "aligned" — resolution has to match the consumer. `@repo/ui` ships raw TSX compiled by Turbopack, which cannot resolve the `.js` specifiers NodeNext requires; the others are compiled and run by Node, which needs them.

**Vitest, not Jest**, in `apps/api` — including `test:e2e` via `vitest.config.e2e.ts` with supertest.

---

## Scripts

Run from the repository root; Turborepo fans them out.

| Script             | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `pnpm dev`         | `web` on :3000 and `api` on :3001, both watching   |
| `pnpm build`       | `next build` + `nest build`, topologically ordered |
| `pnpm lint`        | ESLint in web/ui, oxlint in api                    |
| `pnpm check-types` | `tsc --noEmit` across the workspace                |
| `pnpm test`        | Vitest in api; nothing else has tests yet          |
| `pnpm format`      | Prettier write across `ts`, `tsx`, `md`            |

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

| Missing                                                                          | Specified in                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The 24 Rasi models — only Better Auth's four tables exist so far                 | [data-dictionary.md](../03-data/data-dictionary.md)                                                                             |
| `packages/db` seed                                                               | [data-dictionary.md](../03-data/data-dictionary.md)                                                                             |
| `packages/domain` contents — money maths (the package exists, empty)             | [business-rules.md](../01-product/business-rules.md)                                                                            |
| `packages/contracts` contents — the ts-rest contract (the package exists, empty) | [ADR-0002](../02-architecture/adr/0002-ts-rest-api-contract.md)                                                                 |
| `packages/notifications` — Web Push + FCM adapters                               | [notifications.md](../02-architecture/notifications.md)                                                                         |
| pg-boss queues and the `--worker` boot mode                                      | [ADR-0003](../02-architecture/adr/0003-worker-in-api-process.md), [ADR-0004](../02-architecture/adr/0004-pg-boss-over-redis.md) |
| Service worker, IndexedDB outbox                                                 | [offline-sync.md](../02-architecture/offline-sync.md)                                                                           |
| The scoped repository layer and `RequestContext`                                 | [M02](../01-product/modules/M02-access-control.md)                                                                              |
| Any of M01–M16                                                                   | [prd.md](../01-product/prd.md)                                                                                                  |

The `app.controller` / `app.service` pair in `apps/api` and the starter page in `apps/web` are scaffold, not foundations — expect to delete them rather than grow them.

---

## Local setup

```bash
pnpm install
pnpm dev          # web :3000, api :3001
```

PostgreSQL is **installed natively, no Docker** ([system-architecture](../02-architecture/system-architecture.md#runtime)). Installed version is **17.7**, not the 16 named in system-architecture.

**One database, two schemas.** `rasi_dev` holds development data in `public`; the harness owns `test` and truncates it between runs. `DATABASE_URL` and `TEST_DATABASE_URL` point at the same database and differ only by `?schema=`. The separately-specified `rasi_test` database was not built — schema separation gives the same protection with less to set up. Setup steps are in [`packages/db/README.md`](../../packages/db/README.md).

`.env.example` exists at the repository root. Validation of those variables is still an M16 item ([M16 Platform](../01-product/modules/M16-platform.md)); `apps/api` reads `process.env` directly until the config module lands.

### Prisma 7 differs from most Prisma documentation

Two changes that invalidate examples written before v7, and that no specification in `docs/` anticipates:

- **`url` is gone from the `datasource` block.** The connection string for migration and introspection commands lives in `packages/db/prisma7.config.ts`, which loads the root `.env` explicitly — `dotenv` resolves relative to the working directory, which is `packages/db` when the CLI runs.
- **The runtime client takes a driver adapter**, not a connection string: `@prisma/adapter-pg`. The client is constructed lazily, so importing `@repo/db` neither connects nor requires `DATABASE_URL` until something uses it. That is what lets the Better Auth CLI load `auth.config.ts` before a database exists.

`prisma` and `@prisma/client` are pinned to exactly `7.10.0`. **Do not install either with `@latest`** — at the time of writing `prisma`'s `latest` dist-tag points at `8.0.0-rc.14` while `@prisma/client`'s points at stable `7.10.0`, so the obvious command installs mismatched majors, one of them a release candidate.
