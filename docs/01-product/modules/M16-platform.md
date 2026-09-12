# M16 — Platform

**Purpose:** the shared foundation every other module depends on. No business logic.

**Source:** none — infrastructure.

---

## Scope

**In:** configuration loading and validation, structured logging, the error taxonomy, health checks, request context, tracing, the Prisma client, transaction management.

**Out:** anything a user would recognise as a feature.

---

## Configuration

Environment variables validated at startup with a Zod schema. **A missing or malformed variable fails the boot**, with a message naming every problem at once.

> Failing at startup is the whole point. A misconfigured application that boots and then fails on first use fails in production, at a customer's door, to a Junior who cannot do anything about it. Validating everything up front — and reporting all failures together rather than one per restart — moves that discovery to deploy time.

No `process.env` access outside the config module. Every variable is documented in `.env.example` at the repo root.

---

## Logging

Structured JSON via pino. Every log line carries a request id, and a user id where a session exists.

**Redaction is mandatory and allowlist-based** — passwords, tokens, session cookies, push subscription keys and credential fields never reach a log.

> A denylist is a list of the leaks you thought of. An allowlist is a list of what is safe, and the default for anything new is redacted.

| Level | Used for |
| --- | --- |
| `error` | Unexpected failures requiring attention |
| `warn` | Handled problems: discrepancies, retries, validation failures |
| `info` | State changes: collections, day closes, assignments |
| `debug` | Development only |

Money amounts are logged as strings, never numbers — consistent with BR-11 and so a log line can never introduce float drift into an investigation.

---

## Error taxonomy

Four categories, mapped to HTTP:

| Category | Status | Meaning |
| --- | --- | --- |
| `ValidationError` | `400` | Malformed or invalid input |
| `AuthenticationError` | `401` | No valid session |
| `AuthorizationError` | `403` | Valid session, denied action |
| `NotFoundError` | `404` | Absent **or out of scope** (M02) |
| `ConflictError` | `409` | State conflict — not used for idempotent replays |
| `DomainError` | `422` | Business rule violation |
| `InternalError` | `500` | Everything else |

Every response carries a stable machine-readable `code`, a human message, and field-level detail where applicable.

> `DomainError` is separate from `ValidationError` on purpose. "Invested amount must be below account amount" is not a malformed field — the input was well-formed and the business rejected it. The client shows those differently, and conflating them makes good error messages impossible.
>
> Internal errors never leak stack traces or database messages to the client; they carry a correlation id that matches the log.

---

## Transactions

A single transaction helper used by every module that writes money.

**The rule: a money write and its ledger posting share one transaction** (BR-18). So do audit entries (M13) and job enqueues (M14).

Prisma interactive transactions with an explicit timeout. Nested calls join the outer transaction rather than opening a new one.

---

## Request context

Resolved once per request: `requestId`, `userId`, `role`, `currentLineId`. Provided via `AsyncLocalStorage` so logging and the repository layer reach it without threading it through every signature.

This is what M02's repository-level scoping consumes.

---

## Health checks

| Endpoint | Checks |
| --- | --- |
| `/health/live` | Process is up |
| `/health/ready` | Database reachable, migrations current, queue reachable |
| `/health/info` | Version, build identifier, server time and timezone |

`/health/info` reports server time and timezone deliberately — clock or timezone drift on a host is a real cause of misfiled business dates (BR-12), and it should be visible without shell access.

---

## Tracing

OpenTelemetry spans across HTTP, Prisma and pg-boss, with Sentry for error aggregation. Trace id propagates into logs via the request id.

Sampling: 100% for errors, 10% otherwise. The offline sync endpoint is sampled at 100% during launch — it is the highest-risk path and the one whose failures are hardest to reproduce.

---

## Prisma client

One client instance, exported from `packages/db`, injected as a Nest provider. `packages/db` is the sole owner of the schema and its migrations — including the Better Auth tables, which are generated into it (M01).

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Config error discovered at runtime | Startup validation, all failures reported together |
| Secrets leak into logs | Allowlist redaction, reviewed in code review |
| Transaction timeout under load | Explicit timeouts, money transactions kept short |
| Connection pool exhaustion | Pool sized per process; worker and API sized separately |
| Trace volume costs | Sampling, with error traces always kept |
