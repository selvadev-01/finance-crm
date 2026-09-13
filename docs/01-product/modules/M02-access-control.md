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

**"Current assignment" is resolved from `line_assignment` where `effectiveTo IS NULL`** — never from a field on the staff record (M03).

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

## Risks

| Risk                                     | Mitigation                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| A new endpoint forgets scoping           | Repository layer refuses unscoped queries; no default context                          |
| Stale `currentLineId` after reassignment | Event-driven invalidation, not TTL                                                     |
| Scope check skipped on aggregate queries | Dashboard endpoints are explicitly role-gated; totals are computed from scoped queries |
