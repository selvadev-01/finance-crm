# M02 — Access Control

**Purpose:** decide what each authenticated staff member may do, and which rows they may do it to.

**Source:** PDF §26, Appendix A. Full matrix in [`../rbac-matrix.md`](../rbac-matrix.md).

---

## Scope

**In:** role definitions, the permission matrix, the policy guard, and — most importantly — **data scoping predicates** injected at the repository layer.

**Out:** authentication (M01), assignment data itself (M03).

---

## The two-part model

Every request is checked twice, in order:

1. **Action** — may this role perform this operation at all?
2. **Scope** — which rows may it touch?

Both are server-side. Neither may be satisfied by UI alone.

```
JUNIOR  + record_collection  → allowed action
        + customer on my line, assigned to me → allowed rows
```

A Junior calling the collection endpoint for another line's customer passes check 1 and fails check 2.

---

## Scoping predicates

| Role          | Predicate                                                              |
| ------------- | ---------------------------------------------------------------------- |
| `SUPER_ADMIN` | none                                                                   |
| `ADMIN`       | none                                                                   |
| `SENIOR`      | `lineId = current assignment`                                          |
| `JUNIOR`      | `lineId = current assignment` **and** customer assigned to this Junior |

**"Current assignment" is the `line_assignment` in effect on today's business date** (`effectiveFrom ≤ today`, `effectiveTo` null or `≥ today` — corrected 2026-09-13 from "`effectiveTo IS NULL`"; see As built) — never from a field on the staff record (M03).

### Historical rows scope by their own attribution

A Senior moved from Line 3 to Line 7 sees Line 7's data, including collections recorded before they arrived — and loses visibility of Line 3 entirely.

> The line is the unit of responsibility; the person is not. The consequence to accept consciously is that a Senior cannot review their own past work after a transfer. Admins can, and that is the right place for it.

---

## Enforcement design

Scoping is applied **at the repository layer**, not in controllers or services.

> Controller-level scoping is a rule that every future endpoint must remember to follow, and one that is silently violated the first time someone adds a query in a hurry. Injecting the predicate where queries are constructed makes an unscoped query something you have to write deliberately rather than something you get by forgetting.

A request context carrying `userId`, `role` and `currentLineId` is resolved once per request and passed down. Repository methods require it; there is no default.

---

## Failure semantics

| Situation                      | Response | Reason                                                |
| ------------------------------ | -------- | ----------------------------------------------------- |
| Row outside scope              | `404`    | A Junior probing IDs learns nothing about what exists |
| Denied action on a visible row | `403`    | Existence is already known; no information leaks      |
| No session                     | `401`    |                                                       |

---

## Operations

This module exposes no endpoints of its own. It provides:

- A global `PolicyGuard` running after Better Auth's `AuthGuard`
- A `@RequirePermission(...)` decorator
- A scoped repository base that refuses to build an unscoped query
- A `RequestContext` provider

---

## Events consumed

| Event                      | Effect                            |
| -------------------------- | --------------------------------- |
| `staff.suspended` (M01)    | Revoke sessions immediately       |
| `staff.role_changed` (M01) | Invalidate cached context         |
| `assignment.changed` (M03) | Invalidate cached `currentLineId` |

> Assignment changes must invalidate the cached context immediately. A Senior moved off a line who keeps that line's visibility until their session refreshes is a real access-control failure, not a cosmetic lag.

---

## Testing requirement

**Every cell in the RBAC matrix is an API-level test asserting the actual HTTP status.** Verifying that a button is hidden does not count. PRD release gate 5 depends on this module and is verified here, not in the UI.

---

## As built

In `apps/api/src/access/`. Story status is in the [backlog](../../06-delivery/backlog.md); this records how the design above was realised and where it differs.

**One global guard, fixed order.** `PolicyGuard` is the only `APP_GUARD`; Better Auth's global guard is disabled and its session check runs inside `PolicyGuard` through `RasiAuthGuard`, because the order of several global guards depends on module import order. Each step has a fixed response:

| Step                                     | Failure                        |
| ---------------------------------------- | ------------------------------ |
| `@AllowAnonymous()`                      | — (allowed, nothing resolved)  |
| Valid session                            | `401 UNAUTHENTICATED`          |
| Route declares `@RequirePermission`      | `403 ROUTE_PERMISSION_MISSING` |
| `ACTIVE`, undeleted `staff_profile`      | `401 STAFF_NOT_ACTIVE`         |
| Role holds the permission                | `403 PERMISSION_DENIED`        |
| Row in scope (repository, not the guard) | `404 <ENTITY>_NOT_FOUND`       |

A suspended, inactive, soft-deleted or profile-less user gets the same `STAFF_NOT_ACTIVE`, whatever the reason. `RouteAccessAudit` refuses to **start** an application containing a route with neither decorator, naming it.

**A `PERMISSION_DENIED` is recorded, not only logged** ([M13 as built](M13-audit.md), [ADR-0014](../../02-architecture/adr/0014-security-event-log.md)). The guard also sets the matched route pattern on the request, so a service that refuses deep inside a call can name the route it was reached through. Recording is best-effort and outside any transaction: if the row cannot be written the failure is logged and the same `403` still reaches the caller. `UNAUTHENTICATED` and `STAFF_NOT_ACTIVE` are **not** recorded — there is no resolved caller to name, and a failed sign-in is already a `LOGIN` audit entry (M01).

**Permissions** — `permissions.ts` maps each action in the [RBAC matrix](../rbac-matrix.md) to the roles allowed it. `permissions.spec.ts` parses the matrix document and fails when the map and the document disagree, when a matrix row is unmapped, or when a permission has no row.

**Request context** — resolved on every request from `staff_profile` and the `line_assignment` row with `effectiveTo IS NULL`: `requestId`, `userId`, `staffProfileId`, `organizationId`, `role`, `currentLineId`. **"Current" is date-aware** — the assignment with `effectiveFrom ≤ today ≤ effectiveTo` on today's business date, not merely the one with no end date (decided 2026-09-13 with M03, because a move made "effective tomorrow" opens its row today). **It is not cached**, so the "events consumed" above need no invalidation: a suspension, role change or reassignment takes effect on the next request, proven over HTTP with the session unchanged. Controllers take it with `@CurrentContext()` and pass it explicitly to repository methods.

**Scope** — `scope.ts`: `sectorScope`, `lineScope`, `customerScope` and `collectionScope` return Prisma filters. Admins and Super Admins are bounded by their `organizationId` (added with M03) — "all" never means another organization's rows; `inScope(scope, where)` combines one with a query's own filter; `foundInScope(row, entity)` turns a missing row into the `404`. A Senior or Junior with no current assignment matches no rows. A Junior's collections are their own entries (`collectedByUserId`) on their current line. Historical rows scope by their frozen `lineId`, proven against real collections in a rolled-back test.

**"Customer assigned to this Junior" — decided 2026-09-13: every customer on the Junior's current line.** The data model has no customer-to-Junior assignment. The rule lives in one function (`juniorCustomers`), so a future `customer_assignment` table changes it without touching callers. Recorded as an open question in the [RBAC matrix](../rbac-matrix.md#data-scoping).

**The RBAC matrix harness** (`apps/api/test/rbac-matrix.e2e-spec.ts`) is generated from `RouteAccessAudit.routes()` — the routes the app actually serves. Every route × role is a test asserting the real status (`403 PERMISSION_DENIED` without the permission, neither `401` nor `403` with it), plus `401` with no session; a pinned table of route → permission makes a new, removed or re-permissioned route fail until the table is edited. The chain is complete for the action half: matrix document → `permissions.ts` (`permissions.spec.ts`) → every served route (the harness). Row scope is asserted per module.

**Not enforced mechanically:** `Database.client` remains reachable, so a service could still write an unscoped query. The protection is that repository methods require a `RequestContext` and scope through `inScope`, and review — not a type or a runtime check. Predicates for accounts, schedules, day close and cash arrive with the modules that own those tables.

---

## Risks

| Risk                                     | Mitigation                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| A new endpoint forgets scoping           | Repository layer refuses unscoped queries; no default context                          |
| Stale `currentLineId` after reassignment | Event-driven invalidation, not TTL                                                     |
| Scope check skipped on aggregate queries | Dashboard endpoints are explicitly role-gated; totals are computed from scoped queries |
