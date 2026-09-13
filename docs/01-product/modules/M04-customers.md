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

## Risks

| Risk                                                  | Mitigation                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Duplicate customers created over time                 | Warn on matching mobile; periodic duplicate report                               |
| Line transfer mid-account confuses attribution        | BR-15 freezes collection attribution; the transfer screen states this explicitly |
| Customer marked inactive stops collection by accident | Status has no effect on collection; only account status does                     |
