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
│  ├─ ui/                @repo/ui — button, card, code
│  ├─ eslint-config/     @repo/eslint-config — base, next, react-internal
│  └─ typescript-config/ @repo/typescript-config — base, nextjs, react-library
└─ docs/                 this specification set
```

`pnpm-workspace.yaml` globs `apps/*` and `packages/*`, so a new package is picked up by creating the directory.

**Package names are `@repo/*`, not `@rasi/*`.** This is the Turborepo starter convention the repository was created with, and the docs follow it. Keep it consistent when adding packages — `@repo/db`, `@repo/domain`, `@repo/contracts`.

---

## Toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Node | `>=24` | Enforced by `engines` in the root `package.json` |
| pnpm | `11.25.0` | Pinned via `packageManager` |
| Turborepo | `2.10.x` | Task graph in `turbo.json`, TUI enabled |
| TypeScript | `7.0.2` (root, web, ui) · `^6.0.2` (api) | The api is one major behind; align when it next gets touched |
| Prettier | `3.9.6` | Root `format` script, over `**/*.{ts,tsx,md}` |

### Per app

| | `apps/web` | `apps/api` |
| --- | --- | --- |
| Framework | Next.js `16.3.4`, React `19.2.8` | NestJS `12`, Express platform |
| Module system | ESM | ESM (`"type": "module"`) |
| Lint | ESLint `10` flat config, `--max-warnings 0` | oxlint `1.58` over `src/` and `test/` |
| Tests | none yet | Vitest `4`, plus a separate e2e config |
| Styling | `globals.css` + CSS Modules | — |
| Dev port | `3000` | `3001` (`PORT` env overrides) |

**No Tailwind and no shadcn/ui yet.** `packages/ui` holds three plain React components. The design system the [screen specs](../05-ux/screen-specs.md) assume has not been set up.

**Vitest, not Jest**, in `apps/api` — including `test:e2e` via `vitest.config.e2e.ts` with supertest.

---

## Scripts

Run from the repository root; Turborepo fans them out.

| Script | What it does |
| --- | --- |
| `pnpm dev` | `web` on :3000 and `api` on :3001, both watching |
| `pnpm build` | `next build` + `nest build`, topologically ordered |
| `pnpm lint` | ESLint in web/ui, oxlint in api |
| `pnpm check-types` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest in api; nothing else has tests yet |
| `pnpm format` | Prettier write across `ts`, `tsx`, `md` |

**The type-check script is `check-types`, not `typecheck`.** Turborepo's task name and the per-package script name have to match, so use the existing name rather than adding a second one.

---

## ESM in `apps/api`

`apps/api` is ESM, which the default NestJS templates are not. Two consequences that bite immediately:

```ts
// ✓ relative imports carry the .js extension, even from .ts files
import { AppService } from './app.service.js';

// ✗ resolves in the editor, fails at runtime
import { AppService } from './app.service';
```

Top-level `await` is available and already used in `apps/api/src/main.ts` — `await bootstrap()` rather than a floating promise.

---

## Not yet present

Everything in this list is specified but unbuilt. The [roadmap](../06-delivery/roadmap.md) sequences it, starting with the rest of Phase 0.

**This table is maintained.** When one of these lands, delete its row and add it to the workspace tree above with its real version. Per-story progress is not tracked here — it lives in [`backlog.md`](../06-delivery/backlog.md).

| Missing | Specified in |
| --- | --- |
| PostgreSQL — `rasi_dev`, `rasi_test` | [erd.md](../03-data/erd.md) |
| `packages/db` — Prisma schema, migrations, seed | [data-dictionary.md](../03-data/data-dictionary.md) |
| `packages/domain` — money maths, framework-free | [business-rules.md](../01-product/business-rules.md) |
| `packages/contracts` — Zod + ts-rest contract | [ADR-0002](../02-architecture/adr/0002-ts-rest-api-contract.md) |
| `packages/notifications` — Web Push + FCM adapters | [notifications.md](../02-architecture/notifications.md) |
| Better Auth, mounted in the api | [authentication.md](../02-architecture/authentication.md) |
| pg-boss queues and the `--worker` boot mode | [ADR-0003](../02-architecture/adr/0003-worker-in-api-process.md), [ADR-0004](../02-architecture/adr/0004-pg-boss-over-redis.md) |
| Service worker, IndexedDB outbox | [offline-sync.md](../02-architecture/offline-sync.md) |
| The scoped repository layer and `RequestContext` | [M02](../01-product/modules/M02-access-control.md) |
| Any of M01–M16 | [prd.md](../01-product/prd.md) |

The `app.controller` / `app.service` pair in `apps/api` and the starter page in `apps/web` are scaffold, not foundations — expect to delete them rather than grow them.

---

## Local setup

```bash
pnpm install
pnpm dev          # web :3000, api :3001
```

PostgreSQL is **installed natively, no Docker** ([system-architecture](../02-architecture/system-architecture.md#runtime)). Nothing in the repository needs it yet; it becomes a prerequisite with `packages/db`.

There is no environment-file handling in the scaffold beyond `process.env.PORT`. Configuration loading and validation are an M16 item ([M16 Platform](../01-product/modules/M16-platform.md)).
