# API Design

REST over a shared typed contract. Decision in [ADR-0002](adr/0002-ts-rest-api-contract.md).

---

## The contract

`packages/contracts` holds Zod schemas and a ts-rest contract consumed by **both** NestJS and Next.js.

```
packages/contracts/src/
├─ collections.contract.ts
├─ accounts.contract.ts
├─ shared/money.ts        Decimal-as-string schema
└─ index.ts
```

One definition produces server-side validation, client types and runtime parsing. Changing a response shape surfaces as a TypeScript error in both applications immediately.

> Chosen over OpenAPI codegen (a build step that drifts between regenerations) and tRPC (no plain REST surface). The offline outbox replays stored HTTP requests from a service worker, so the API must be ordinary REST — a request that can be serialised, stored for hours and replayed without a client runtime.

---

## Conventions

**Resources are plural nouns.** Actions that are not CRUD are sub-resources, not verbs in a path.

```
GET    /api/customers
POST   /api/accounts
POST   /api/accounts/:id/disbursement      not /disburse-account
POST   /api/collections
POST   /api/collections/:id/correction
POST   /api/day-closes/:id/closure
POST   /api/cash-handovers/:id/acknowledgement
```

**Nesting is one level deep, maximum.** `/api/lines/:id/customers` is fine; deeper nesting becomes a query parameter.

| Method   | Semantics                                         |
| -------- | ------------------------------------------------- |
| `GET`    | Read, no side effects                             |
| `POST`   | Create, or a state transition                     |
| `PATCH`  | Partial update                                    |
| `PUT`    | Not used — no full-replacement semantics anywhere |
| `DELETE` | Soft delete only                                  |

**Collections are never `PATCH`ed or `DELETE`d.** There is no update route for them at all — corrections are `POST /collections/:id/correction` (BR-14).

---

## Money on the wire

**Amounts cross the API as decimal strings**, never JSON numbers.

```json
{ "amount": "100.00", "expectedAmount": "100.00", "variance": "0.00" }
```

> JSON numbers are IEEE 754 doubles. Serialising money as a number invites the client to parse it into a float, and BR-11's guarantee ends at the API boundary. A string forces the client to choose a decimal type. The Zod money schema validates the format and rejects anything else, which makes the rule enforceable rather than aspirational.

Dates: `businessDate` as `YYYY-MM-DD`, timestamps as ISO 8601 with offset.

---

## Idempotency

`POST /api/collections` requires an `idempotencyKey` in the body (BR-13).

| Situation                      | Response                          |
| ------------------------------ | --------------------------------- |
| First submission               | `201` with the created collection |
| Replay of the same key         | **`200` with the original body**  |
| Key present, different payload | `409` — a genuine client bug      |

> A replay returns success, not a conflict. The client needs to know the collection exists; whether this request created it is irrelevant. Returning `409` for a replay would force clients to treat an error as a success.

---

## Errors

One shape for every error:

```json
{
  "code": "ACCOUNT_INVESTED_EXCEEDS_AMOUNT",
  "message": "Invested amount must be below the account amount",
  "details": [
    { "field": "investedAmount", "issue": "must be less than accountAmount" }
  ],
  "correlationId": "req_01H..."
}
```

| Status | Category                                            |
| ------ | --------------------------------------------------- |
| `400`  | Malformed input                                     |
| `401`  | No valid session                                    |
| `403`  | Denied action on a visible row                      |
| `404`  | Absent **or out of scope**                          |
| `409`  | State conflict (not idempotent replay)              |
| `422`  | Business rule violation                             |
| `500`  | Internal — correlation id only, never a stack trace |

**`404` for out-of-scope rows is deliberate** (M02): a Junior probing IDs learns nothing about what exists. `403` is safe only where the row's existence is already known.

**`422` is distinct from `400`.** "Invested must be below account amount" is well-formed input rejected by the business — clients display the two differently, and conflating them makes good error messages impossible.

`code` values are stable and machine-readable; `message` may be reworded freely.

---

## Pagination

Cursor-based on every list endpoint.

```
GET /api/collections?cursor=eyJpZCI6...&limit=50
```

```json
{ "data": [...], "nextCursor": "eyJpZCI6...", "hasMore": true }
```

> Offset pagination skips or repeats rows when data is inserted mid-scan, and collections are inserted continuously throughout the day. Cursors are stable under concurrent writes.

Default limit 50, maximum 200. **Every list endpoint is bounded** — reports additionally require a date range, defaulting to the current month.

---

## Filtering and sorting

Explicit allowlisted query parameters, not a generic query language.

```
GET /api/collections?lineId=...&from=2026-09-01&to=2026-09-30&classification=LOW
```

**Scoping is applied before any filter is honoured.** A Senior filtering by another line receives their own line's data, not an error and not the other line's.

---

## Versioning

**Unversioned in v1.** Both clients deploy with the server from one repository.

> A version prefix on an API with no external consumers is ceremony. When a genuinely external consumer appears, `/api/v2` is added at that point — and the offline PWA is the closest thing to one, which is why the contract package is shared rather than duplicated: a client running old code is a deploy-skew problem, not a versioning one.

**Deploy skew is real**, though: a Junior's PWA may be hours old. Additive changes only — never remove or repurpose a request field without a migration window.

---

## Auth

Better Auth session cookie (`httpOnly`, `secure`, `sameSite: "lax"`). Same-origin in production, so the offline outbox replays with the cookie attached and no token handling.

`/api/auth/*` is Better Auth's. Everything else is `AuthGuard` → `PolicyGuard`.

---

## Rate limiting

| Endpoint group          | Limit              |
| ----------------------- | ------------------ |
| `/api/auth/sign-in`     | 5 / 15 min per IP  |
| `POST /api/collections` | 300 / min per user |
| Reports                 | 10 / min per user  |
| Default                 | 100 / min per user |

> The collection limit is high on purpose: a Junior reconnecting after a day offline legitimately submits a hundred collections in seconds. Rate limiting the sync path too aggressively would break the core offline guarantee — the limit exists to catch a runaway client, not to shape normal traffic.

---

## Documentation

OpenAPI generated from the ts-rest contract, served at `/api/docs` in non-production. Generated, never hand-written, so it cannot drift from the contract.
