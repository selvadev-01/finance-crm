# Architecture Decision Records

One decision per file, numbered, never deleted. A decision that turns out wrong gets a new ADR that supersedes it — the original stays, because the reasoning that led to it is what future readers need in order to avoid repeating it.

**Format:** Context · Decision · Consequences · Alternatives considered.

**Status:** `Proposed` · `Accepted` · `Superseded by ADR-nnnn`.

> **Accepted is not implemented.** All nine decisions below are settled, and none is in the code yet beyond the monorepo shape of 0001 — no Prisma, no ts-rest, no pg-boss, no Better Auth, no service worker. [`project-structure.md`](../../04-engineering/project-structure.md#not-yet-present) tracks the gap. If implementation contradicts an ADR, write the superseding ADR; do not quietly diverge.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith, not microservices | Accepted |
| [0002](0002-ts-rest-api-contract.md) | ts-rest + Zod for the API contract | Accepted |
| [0003](0003-worker-in-api-process.md) | Worker is the API app in `--worker` mode | Accepted |
| [0004](0004-pg-boss-over-redis.md) | pg-boss on Postgres, no Redis | Accepted |
| [0005](0005-balance-driven-completion.md) | Accounts complete on balance, not day count | Accepted |
| [0006](0006-append-only-ledger.md) | Append-only collections + double-entry ledger | Accepted |
| [0007](0007-better-auth.md) | Better Auth, mounted in the NestJS API | Accepted |
| [0008](0008-offline-first-pwa.md) | Offline-first PWA with an IndexedDB outbox | Accepted |
| [0009](0009-decimal-money-stored-dates.md) | Decimal money and stored business dates | Accepted |

## When to write one

Write an ADR when a choice is hard to reverse, when a reasonable engineer would choose differently, or when you expect to be asked "why did you do it that way". Do not write one for choices that follow from an existing ADR, or for matters of formatting and style — those belong in the [coding guidelines](../../04-engineering/coding-guidelines.md).
