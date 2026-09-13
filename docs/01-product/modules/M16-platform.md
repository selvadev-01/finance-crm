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

| Level   | Used for                                                      |
| ------- | ------------------------------------------------------------- |
| `error` | Unexpected failures requiring attention                       |
| `warn`  | Handled problems: discrepancies, retries, validation failures |
| `info`  | State changes: collections, day closes, assignments           |
| `debug` | Development only                                              |

Money amounts are logged as strings, never numbers — consistent with BR-11 and so a log line can never introduce float drift into an investigation.

---

## Error taxonomy

Four categories, mapped to HTTP:

| Category              | Status | Meaning                                          |
| --------------------- | ------ | ------------------------------------------------ |
| `ValidationError`     | `400`  | Malformed or invalid input                       |
| `AuthenticationError` | `401`  | No valid session                                 |
| `AuthorizationError`  | `403`  | Valid session, denied action                     |
| `NotFoundError`       | `404`  | Absent **or out of scope** (M02)                 |
| `ConflictError`       | `409`  | State conflict — not used for idempotent replays |
| `DomainError`         | `422`  | Business rule violation                          |
| `InternalError`       | `500`  | Everything else                                  |

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

| Endpoint        | Checks                                                  |
| --------------- | ------------------------------------------------------- |
| `/health/live`  | Process is up                                           |
| `/health/ready` | Database reachable, migrations current, queue reachable |
| `/health/info`  | Version, build identifier, server time and timezone     |

`/health/info` reports server time and timezone deliberately — clock or timezone drift on a host is a real cause of misfiled business dates (BR-12), and it should be visible without shell access.

---

## Tracing

OpenTelemetry spans across HTTP, Prisma and pg-boss, with Sentry for error aggregation. Trace id propagates into logs via the request id.

Sampling: 100% for errors, 10% otherwise. The offline sync endpoint is sampled at 100% during launch — it is the highest-risk path and the one whose failures are hardest to reproduce.

---

## Prisma client

One client instance, exported from `packages/db`, injected as a Nest provider. `packages/db` is the sole owner of the schema and its migrations — including the Better Auth tables, which are generated into it (M01).

---

## As built

In `apps/api/src/platform/`. Status is in the [backlog](../../06-delivery/backlog.md); this section records how the spec above was realised and where it differs.

**Configuration** — `config/config.ts`, Zod 4. Variables: `NODE_ENV`, `PORT`, `DATABASE_URL`, `BETTER_AUTH_SECRET` (the `CHANGEME` placeholder rejected; 32 characters required in production), `WEB_ORIGIN` (an origin, no path), `LOG_LEVEL`, optional `BUILD_ID`. Messages name the variable and the rule, never the value. `main.ts` validates before importing the application module, because `auth.config.ts` reads configuration at import time and a static import would surface a bad `.env` as a stack trace. `packages/db` still reads `DATABASE_URL` itself — the rule is scoped to `apps/api`.

**Logging** — `nestjs-pino`. Redaction is applied to the finished JSON line (`hooks.streamWrite`), after serializers and child loggers, so nothing can bypass it. Every key at every depth is checked against `SAFE_LOG_KEYS` in `logging/redact.ts`; an unlisted key keeps its name and its value becomes `"[REDACTED]"`. Requests log method, path without query string, status and duration; headers and bodies are never serialized. Adding a key to the allowlist is a security decision. Error messages and stacks are allowlisted, so an error message must never be built from a secret.

**Errors** — `errors/errors.ts` defines `AppError` and the seven categories; one global filter produces `{ code, message, details?, correlationId }`. A `ZodError` becomes `400 VALIDATION_FAILED` with a detail per field path. Nest's own 4xx exceptions (unknown route, the auth guard's 401) are mapped into the same shape. A `5xx` — including an `InternalError` — shows a generic message; an `InternalError` keeps its `code`. JSON body-parser failures happen before Nest's filter and are answered in the same shape by `configureApp`. `/api/auth/*` is served by Better Auth's own handler and keeps Better Auth's error format.

**Transactions** — `database/database.ts`, the `Database` provider. `client` is the open transaction when there is one, otherwise the base client; `transaction(run)` opens one (default `maxWait` 2 s, `timeout` 5 s) or joins the open one. Joining is required, not a nicety: **a Prisma 7 transaction client exposes `$transaction`, and a nested call through it commits independently — its writes survive the outer transaction's rollback.** Verified by test. Modules must write through `Database`, never `$transaction` directly.

**Request context** — `context/request-context.ts`. Every request has a `requestId` (`req_<uuid>`, always server-generated, returned as `X-Request-Id` and as `correlationId`). On a `@RequirePermission` route, M02's `PolicyGuard` adds the full `RequestContext` — `userId`, `staffProfileId`, `organizationId`, `role`, `currentLineId` — and assigns `userId` to the request's logger, so every later line, including request-completed, carries it ([M02 as built](M02-access-control.md#as-built)).

**Health** — `/health/live`, `/health/ready`, `/health/info`, all public and outside `/api`. Readiness returns `503` when the database is unreachable (2 s timeout), a shipped migration is unapplied, or a migration row is unfinished; it reports counts, not migration names. `/health/info` returns `version`, `buildId`, `serverTime`, `serverTimeZone`, `serverUtcOffsetMinutes`, `businessTimeZone` and today's `businessDate` from `toBusinessDate`. **The queue check is not built** — pg-boss arrives with M14.

**Authentication guard** — Better Auth's global `AuthGuard` resolves the session before checking whether a route is public, which would make liveness depend on the database. It is disabled; M02's `PolicyGuard` handles public routes first and only then runs the session check ([authentication.md](../../02-architecture/authentication.md)).

**Tracing is not built.** OpenTelemetry and Sentry need an external account and wait for deployment, which is deferred by decision.

**Testing** — `configureApp` is shared by `main.ts` and every HTTP test through `test/app.ts#createTestApp`. nestjs-pino holds its root logger statically, so a test asserting on logs builds one app per file and filters lines by request id.

---

## Risks

| Risk                               | Mitigation                                              |
| ---------------------------------- | ------------------------------------------------------- |
| Config error discovered at runtime | Startup validation, all failures reported together      |
| Secrets leak into logs             | Allowlist redaction, reviewed in code review            |
| Transaction timeout under load     | Explicit timeouts, money transactions kept short        |
| Connection pool exhaustion         | Pool sized per process; worker and API sized separately |
| Trace volume costs                 | Sampling, with error traces always kept                 |
