# ADR-0011 — An in-house contract over Zod, replacing ts-rest

**Status:** Accepted · 2026-09-13 · Supersedes the library choice in [ADR-0002](0002-ts-rest-api-contract.md)

## Context

[ADR-0002](0002-ts-rest-api-contract.md) chose ts-rest with Zod for the shared API contract. Its reasons still hold: one definition for both applications, no codegen to drift, and plain REST that the offline outbox can store and replay with `fetch`.

The library does not fit the stack the repository now runs. Checked on npm on 2026-09-13, when the first endpoints (M03) were built:

- **The latest stable release, 3.52.1 (March 2025), requires Zod 3 and NestJS 9–11.** Rasi runs Zod 4.6.2 and NestJS 12.
- **The only newer build is `3.53.0-rc.1` (June 2025).** It accepts Zod 4 through Standard Schema, but `@ts-rest/nest` still declares NestJS ≤ 11.
- **Nothing had been published for fifteen months.**

Adopting it would have meant pinning an unfinished release, outside its declared framework range, as the foundation every endpoint is built on.

## Decision

**`packages/contracts` defines its own minimal contract.** A route is a plain object — method, full path with `:param` segments, and a Zod schema for path parameters, query, body and each response status — declared with `route()`, which refuses a route without exactly one 2xx response.

- **Server:** `@ContractRoute(route)` in `apps/api` sets the method, path and success status, and **parses the response through the success schema**. `@ContractInput()` validates path parameters, query and body; a failure is `400 VALIDATION_FAILED` with field detail. Guards run first, so an unauthenticated request is refused before its body is examined.
- **Client:** `createApiClient` is a typed `fetch` wrapper. It parses success bodies with the same schema, so a server that drifts from the contract fails at the client instead of rendering wrong data.
- **Types:** `RouteInput<Route>`, `RouteRequest<Route>` and `RouteSuccess<Route>` derive handler and client types from the route object. Nothing is generated.

## Consequences

**Good**

- Every ADR-0002 goal is kept: one definition, no codegen, types and validation from the same schema, ordinary replayable REST
- No dependency on an unmaintained library, and no peer-range violation on the framework
- **Responses are shaped, not merely typed.** Zod object schemas drop undeclared keys, so a field a service returns by accident — an invested amount on a Junior's payload — never leaves the API unless the contract names it. Verified by a test in which a service deliberately selects an extra column
- Small enough to read in one sitting: the route type, the Nest decorators and the client are each under 150 lines

**Bad**

- Rasi owns the code: features ts-rest would have provided — OpenAPI generation, typed error unions per status — are Rasi's to build when needed
- Response parsing costs a schema pass per response. Negligible at Rasi's volumes; worth measuring on the Junior's route endpoint

**Neutral**

- OpenAPI, which [api-design.md](../api-design.md#documentation) promises at `/api/docs`, is not built. Zod 4's built-in JSON Schema export is the intended source when it is

## Alternatives considered

**`@ts-rest/core` and `@ts-rest/nest` at `3.53.0-rc.1`.** Less code to own, and rejected: a release candidate from a project with no release in fifteen months, used outside its declared NestJS range, is a poor foundation for every endpoint in the system.

**ts-rest 3.52.1 with Zod 3.** Rejected. It would mean downgrading Zod in `packages/contracts` and running NestJS 12 outside the adapter's peer range anyway.

**OpenAPI with a generated client, or tRPC.** Rejected for the reasons recorded in ADR-0002, which are unchanged.
