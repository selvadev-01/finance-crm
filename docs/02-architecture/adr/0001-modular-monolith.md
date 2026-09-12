# ADR-0001 — Modular monolith, not microservices

**Status:** Accepted · 2026-09-12

## Context

Rasi has sixteen modules covering identity, organisation, lending, collection, cash control, ledger, notifications and reporting. It serves about 60 staff and 1,000 customers, built and maintained by one small team.

The module list looks like a service map. It is not one.

## Decision

**One NestJS application containing all sixteen modules**, with boundaries enforced in code rather than over a network.

Boundaries are real and enforced:

- Cross-module communication is by **domain event** wherever the relationship is a reaction rather than a dependency
- All data access passes through a **scoped repository layer**
- Money logic lives in `packages/domain` with **no framework imports**
- Module dependencies follow the graph in the [PRD](../../01-product/prd.md#dependencies); cycles are a lint failure

## Consequences

**Good**

- One deployment, one database, one transaction. A collection, its ledger postings, its notification and its audit entry commit atomically — which distributed services could not guarantee without a saga
- One team can hold the whole system in their heads
- Refactoring across module boundaries is a code change, not a coordinated release
- Operationally cheap: one VPS, one backup, one recovery procedure

**Bad**

- Modules scale together. A heavy report competes with collection writes — mitigated by the separate worker process ([ADR-0003](0003-worker-in-api-process.md))
- Boundary discipline is a convention. A determined developer can reach across it, so code review must watch for it
- The whole application redeploys for any change

**Neutral**

- If a module genuinely needs independent scaling later, the event boundaries are already the seam to extract along

## Alternatives considered

**Microservices.** Rejected. Sixty users and one business do not generate the load or the organisational pressure that justifies distribution. The cost is immediate — network failure modes, distributed transactions, deployment coordination — and the benefit is hypothetical. Money correctness in particular would become dramatically harder: the ledger posting that currently shares a transaction with its collection would need a saga and compensating actions.

**Serverless functions.** Rejected. Background jobs, long-lived queue consumers and connection pooling all fit poorly, and the offline sync path benefits from warm connections.

**Nx instead of Turborepo.** Rejected as heavier than needed. Turborepo's task pipelining and caching cover this repository's requirements without Nx's generator and plugin surface.
