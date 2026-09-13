# ADR-0002 — ts-rest + Zod for the API contract

**Status:** Superseded by [ADR-0011](0011-in-house-api-contract.md) (the library choice) · 2026-09-13 — the goals below still hold

## Context

NestJS and Next.js live in one repository and are built by the same team. They must agree on request and response shapes, and a mismatch should be a compile error rather than a runtime surprise.

One constraint dominates: **the offline outbox replays stored HTTP requests from a service worker**, hours after they were created ([offline-sync](../offline-sync.md)). Whatever the API is, it must be serialisable, storable and replayable without a client runtime.

## Decision

**A ts-rest contract built on Zod schemas in `packages/contracts`**, consumed by both applications.

One definition yields server-side validation, client types and runtime parsing. OpenAPI is generated from it for documentation.

## Consequences

**Good**

- Changing a response shape produces TypeScript errors in both applications immediately
- No codegen step, so no drift between a schema and a regenerated client
- Validation and types come from the same source — they cannot disagree
- The result is ordinary REST: the outbox stores a URL, method and JSON body, replayable with `fetch`
- Zod schemas are reusable in forms, so client-side validation matches the server's exactly

**Bad**

- ts-rest is a smaller ecosystem than OpenAPI. A future non-TypeScript consumer works from generated OpenAPI rather than the contract itself
- Adds a package that both applications must depend on, so a contract change rebuilds both

**Neutral**

- Contract changes are visible in review as a single diff, which is useful for spotting breaking changes

## Alternatives considered

**OpenAPI + generated client.** The conventional choice, and rejected because the generation step drifts. A developer changes a DTO, forgets to regenerate, and the client compiles against a stale type. Making correctness depend on remembering to run a command is a weaker guarantee than making it a compile error.

**tRPC.** Excellent type safety, and rejected on the offline constraint. tRPC's transport is an implementation detail rather than a stable REST surface, and the outbox needs to store and replay plain HTTP requests that remain valid across a client version change. A Junior's PWA may be hours old when it replays.

**Nothing shared — hand-written types on both sides.** Rejected. Two hand-maintained definitions of the same shape diverge, and the divergence surfaces in production.

**GraphQL.** Rejected. Solves a client-flexibility problem Rasi does not have, and complicates the replay path further.
