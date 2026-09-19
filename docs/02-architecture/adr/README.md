# Architecture Decision Records

One decision per file, numbered, never deleted. A decision that turns out wrong gets a new ADR that supersedes it — the original stays, because the reasoning that led to it is what future readers need in order to avoid repeating it.

**Format:** Context · Decision · Consequences · Alternatives considered.

**Status:** `Proposed` · `Accepted` · `Superseded by ADR-nnnn`.

> **Accepted is not implemented.** Of the decisions below, 0001 (monorepo shape), 0006 and 0009 (Decimal money, stored business dates — now in the schema), 0007 (Better Auth, mounted and signing users in), 0010 (Tailwind v4) and 0011 (the in-house contract, serving M03) are in the code. pg-boss and the service worker are not. [`project-structure.md`](../../04-engineering/project-structure.md#not-yet-present) tracks the gap. If implementation contradicts an ADR, write the superseding ADR; do not quietly diverge.

| #                                                       | Decision                                           | Status                      |
| ------------------------------------------------------- | -------------------------------------------------- | --------------------------- |
| [0001](0001-modular-monolith.md)                        | Modular monolith, not microservices                | Accepted                    |
| [0002](0002-ts-rest-api-contract.md)                    | ts-rest + Zod for the API contract                 | Superseded by 0011          |
| [0011](0011-in-house-api-contract.md)                   | In-house contract over Zod, replacing ts-rest      | Accepted                    |
| [0003](0003-worker-in-api-process.md)                   | Worker is the API app in `--worker` mode           | Accepted                    |
| [0004](0004-pg-boss-over-redis.md)                      | pg-boss on Postgres, no Redis                      | Accepted                    |
| [0005](0005-balance-driven-completion.md)               | Accounts complete on balance, not day count        | Accepted                    |
| [0006](0006-append-only-ledger.md)                      | Append-only collections + double-entry ledger      | Accepted                    |
| [0007](0007-better-auth.md)                             | Better Auth, mounted in the NestJS API             | Accepted                    |
| [0008](0008-offline-first-pwa.md)                       | Offline-first PWA with an IndexedDB outbox         | Accepted                    |
| [0009](0009-decimal-money-stored-dates.md)              | Decimal money and stored business dates            | Accepted                    |
| [0010](0010-tailwind-v4-component-base.md)              | Tailwind v4 and an owned component base            | Partly superseded by 0013   |
| [0012](0012-organization-sign-up.md)                    | Public organization sign-up, generated slugs       | Accepted                    |
| [0013](0013-console-re-theme-and-headless-libraries.md) | Console re-theme, webfont, headless libraries      | Accepted — being rolled out |
| [0014](0014-security-event-log.md)                      | Refused attempts in `security_event`, not audit    | Accepted                    |
| [0015](0015-console-layout-and-in-house-charts.md)      | Lavish-structured shell and dashboards, SVG charts | Accepted                    |

## When to write one

Write an ADR when a choice is hard to reverse, when a reasonable engineer would choose differently, or when you expect to be asked "why did you do it that way". Do not write one for choices that follow from an existing ADR, or for matters of formatting and style — those belong in the [coding guidelines](../../04-engineering/coding-guidelines.md).
