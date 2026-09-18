# M04 — Customers

**Purpose:** the customer profile and everything known about the person behind an account.

**Source:** PDF §7, §27.

---

## Scope

**In:** customer CRUD, reference persons, line membership, search, customer 360.

**Out:** accounts (M05), collections (M07). A customer holds accounts; the customer record holds no money.

---

## Owned entities

`customer` · `customer_reference`

---

## Key rules

| Rule                                     | Detail                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| At least one reference is mandatory      | §7. Enforced at onboarding                                     |
| Mobile is indexed, **not unique**        | Families and shops share numbers. Duplicates warn, never block |
| `sectorId` is denormalised from the line | Query convenience; kept consistent on line change              |
| Soft delete only                         | Blocked while any `ACTIVE` account exists                      |
| `lineId` is the **current** line         | Historical attribution lives on `collection` (BR-15)           |

### Duplicate mobile numbers warn rather than block

> Blocking would obstruct real onboarding — a husband and wife on the same line legitimately share a number, as does a customer and the shop they run. A warning showing the existing customer catches genuine double-entry while letting the real case through. This is a case where the strict constraint is the wrong one.

### The customer record holds no balance

Outstanding is **derived by summing active accounts** at read time, never stored on `customer`.

> A customer may hold several active accounts (BR-01a), so a customer-level balance would be a cache of a sum of caches — two layers of drift over the ledger. The account is where money lives.

---

## Customer status

| Status        | Meaning                            | Effect on collection       |
| ------------- | ---------------------------------- | -------------------------- |
| `ACTIVE`      | Normal                             | Collection proceeds        |
| `INACTIVE`    | Hard to reach, moved away          | **Collection continues**   |
| `BLACKLISTED` | Will not be given further accounts | Existing accounts continue |

> Customer status is a **contact-quality flag, not a collection switch** (open question 2). Only `DEFAULTED` or `WRITTEN_OFF` on the _account_ stops collection. Marking a customer inactive must never silently halt collection on money they still owe.

---

## Customer 360

The most-used screen after the Junior's route. Assembles:

| Section                                                  | Source |
| -------------------------------------------------------- | ------ |
| Profile, references                                      | M04    |
| Active accounts, each with its own outstanding           | M05    |
| **Total outstanding, labelled as a sum across accounts** | M05    |
| Completed account history                                | M05    |
| Full collection history with variance                    | M07    |
| Assigned Senior and Junior                               | M03    |

Role-scoped: a Junior sees only assigned customers, and no invested amount or profit anywhere (see [`../rbac-matrix.md`](../rbac-matrix.md#money-visibility-m09-m11-m12)).

---

## Operations

| Operation                | Actor                                              |
| ------------------------ | -------------------------------------------------- |
| Create                   | Admin+                                             |
| Update                   | Admin+                                             |
| Transfer to another line | Admin+                                             |
| Soft delete              | Super Admin                                        |
| List / search            | Admin+ (all), Senior (own line), Junior (assigned) |
| View 360                 | as above                                           |
| Manage references        | Admin+                                             |

---

## Events

**Emitted**

| Event                   | Consumed by                                  |
| ----------------------- | -------------------------------------------- |
| `customer.created`      | M10 (notify the Senior — §12 "new customer") |
| `customer.line_changed` | M10, M11                                     |

**Consumed:** `line.deactivated` (M03) — blocks new customers on that line.

---

## Search

By name, mobile or customer code, scoped by role. Postgres trigram index on name; exact match on mobile and code.

> Admins search constantly during onboarding and problem-chasing. At 1,000 customers a trigram index is ample; no search service is warranted.

---

## As built

In `apps/api/src/customers/`, served through `packages/contracts/src/customer.contract.ts` ([ADR-0011](../../02-architecture/adr/0011-in-house-api-contract.md)). Status is in the [backlog](../../06-delivery/backlog.md).

| Endpoint                         | Permission        | Refusals                                                                                  |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `GET /api/customers`             | `customer.view`   | — (scoped by `customerScope`; `?lineId=`, `?mobile=`, `?status=`)                         |
| `GET /api/customers/:customerId` | `customer.view`   | `404` (out of scope identical to missing). Includes references                            |
| `POST /api/customers`            | `customer.create` | `400` (no reference, bad mobile), `404` line, `422 LINE_INACTIVE`, `409 DUPLICATE_MOBILE` |

**Decided 2026-09-13:**

- **Customer codes are issued by the API** (`CUS-00001`, …) from the Postgres sequence `customer_code_seq`. A create that rolls back leaves a gap, which is harmless.
- **The duplicate-mobile warning is enforced by the server.** A create whose mobile is already on a non-deleted customer in the organization answers `409 DUPLICATE_MOBILE` until it is resent with `confirmDuplicateMobile: true`. The form then lists who has the number (`GET /api/customers?mobile=`). The confirmation is recorded on the audit entry.

**Mobile numbers** are accepted as typed (`98765 43210`, `098765-43210`, `+91 98765 43210`) and stored as E.164 (`+919876543210`). Only Indian mobiles (starting 6–9) are accepted.

**The sector is never sent.** It is copied from the chosen line, which must be one the caller can see and must be active. 1–5 references are accepted at onboarding.

**Screens:**

- `/customers`: the list, with a line filter for Admins.
- `/customers/new` (S-10): keyboard-first, validated with the contract's own schema, "Save and add another" keeps the line.
- `/customers/:id`: the profile and references. Accounts and collections are stated as not yet available.

**Not built:** edit (US-021), Customer 360's accounts and collections (US-022), line transfer (US-023), search by name (US-024, trigram index), soft delete, the `customer.created` notification, and assigning a customer to a particular Junior (no model for it; a Junior sees their whole line, decided 2026-09-13).

---

## Risks

| Risk                                                  | Mitigation                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Duplicate customers created over time                 | Warn on matching mobile; periodic duplicate report                               |
| Line transfer mid-account confuses attribution        | BR-15 freezes collection attribution; the transfer screen states this explicitly |
| Customer marked inactive stops collection by accident | Status has no effect on collection; only account status does                     |
