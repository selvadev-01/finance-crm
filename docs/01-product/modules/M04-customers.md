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

| Endpoint                                        | Permission            | Refusals                                                                                        |
| ----------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/customers`                            | `customer.view`       | `400` over-long `q` (scoped by `customerScope`; `?q=`, `?lineId=`, `?mobile=`, `?status=`)      |
| `GET /api/customers/:customerId`                | `customer.view`       | `404` (out of scope identical to missing). Includes references                                  |
| `POST /api/customers`                           | `customer.create`     | `400` (no reference, bad mobile), `404` line, `422 LINE_INACTIVE`, `409 DUPLICATE_MOBILE`       |
| `PATCH /api/customers/:customerId`              | `customer.update`     | `400` (no reference, bad mobile), `404`, `409 DUPLICATE_MOBILE`, `422 UNKNOWN_REFERENCE`        |
| `POST /api/customers/:customerId/line-transfer` | `customer.changeLine` | `404` customer or line, `422 LINE_INACTIVE`, `422 SAME_LINE`                                    |
| `GET /api/customers/:customerId/line-transfers` | `customer.view`       | `404`. Every line this customer has been on, newest first                                       |
| `GET /api/customers/:customerId/overview`       | `customer.view`       | `404`. Customer 360’s totals and today’s Senior and Juniors                                     |
| `GET /api/lines/:lineId/customer-portfolio`     | `customer.view`       | `404` outside the line scope. The line's customers in visiting order with what each owes (J-09) |
| `GET /api/customers/:customerId/collections`    | `collection.view`     | `400` bad cursor, `404`. The customer’s whole history, newest first (M07)                       |

**Editing (US-021, 2026-09-20)** sends the whole editable record: name, mobiles, address, notes, status and 1–5 references. "Manage references" is part of the edit, not a separate route: a reference sent with its `id` is updated, one without is added, and one left out is removed. An `id` that is not this customer's reference is `422 UNKNOWN_REFERENCE`, so an edit can never reach another customer's row. The duplicate-mobile warning applies only when the mobile changes, and never counts the customer itself. **The line is not editable** — moving a customer is a transfer (US-023, BR-15). The audit entry records the editable fields before and after.

**Search (US-024, 2026-09-20)** is `?q=` on the list: any part of the name, case-insensitive (`ILIKE`), or exactly a customer code — whole or as its number, `417` finding `CUS-00417` — or exactly a mobile in any form onboarding accepts. It runs inside `customerScope`, so a Senior or Junior can never find another line’s customer, even by its exact code. **The trigram index on the name is not built:** `pg_trgm` is available on the server but the `rasi` role has no `CREATE` on the database, so installing it needs a superuser once, as the `pgboss` schema did. The query needs no change when it arrives; at ~1,000 customers a sequential scan is well under a millisecond, so this waits until it is measured to matter.

**Customer 360 (US-022, 2026-09-20).** `GET /api/customers/:customerId/overview` returns the counts of active, completed and other accounts, the **outstanding summed across active accounts**, the lifetime collected across every account, and the line’s current Senior and Juniors — "current" meaning in effect on today’s business date, not merely open (M03). Nothing is stored on the customer: the totals are summed at read time, because a customer may hold several accounts (BR-01a) and a stored total would be a cache of a sum of caches.

**Customer portfolio (2026-09-22), for every role.**

- **The overview** also gives the overdue active accounts, the missed days (MISSED slots on active accounts, BR-09), the last business date money was collected, and the invested and profit totals across all accounts. Invested and profit are `null` for a Junior (RBAC matrix, money visibility). Profit is P = A − I per account (BR-01), so the console calls it "Profit on these accounts", never "earned".
- **`GET /api/lines/:lineId/customer-portfolio`** lists a line's customers in visiting order (US-040): each one's outstanding, active and completed accounts, overdue, missed days, due today and paid today, plus the line's outstanding, active accounts, overdue customers and the last seven days' collections. It has no invested or profit fields, because it is the one shape a Junior may read. It uses a fixed number of queries whatever the line's size.
- **Console:** Customer 360 opens on its Portfolio tab.
- **Junior:** the field app has a Customers tab (`#customers`) and a customer's portfolio (`#customer/<id>`).

The collection history is M07’s, served at `GET /api/customers/:customerId/collections`: one customer’s rows across every account, newest first, cursor-paged on (business date, id). **It is not date-bounded** as S-16 is — that limit exists for an organization-wide list, and 360 shows the whole of one customer’s history. Scope is still `collectionScope`, so a Junior sees their own entries and a Senior their line’s.

**Transfer (US-023, 2026-09-20)** moves the customer and their denormalised sector to the new line **from today**. Past collections are untouched, so neither line’s history changes (BR-15).

Which line a customer was on, and when, is now a table: `customer_line_period` ([data dictionary](../../03-data/data-dictionary.md#customer_line_period)), whose open row mirrors `customer.lineId`. Onboarding opens the first period; a transfer closes the open one and opens the next.

**It exists for offline sync, not for reporting.** A Junior collects at the door with no signal and the phone may not sync for hours ([offline sync](../../02-architecture/offline-sync.md)). If the customer were transferred in between, judging permission by today’s line would refuse money already taken and strand it in the outbox, leaving paper as the only fallback. The collection path (`collectableAccountScope`) instead asks which line the customer was on **on that collection’s business date**, and attributes the collection to that line — not to the line they are on now. On the transfer day both periods cover the date, so either line’s Junior may sync it and the caller’s own line is used.

**Onboarding tells the line’s Senior (US-020, 2026-09-20).** `EventNotices.customerOnboarded` raises an `INFORMATION` notice inside the creating transaction — no customer, no notice — naming who onboarded them and linking to the profile. The Admin who did it is not told of their own action.

**Decided 2026-09-13:**

- **Customer codes are issued by the API** (`CUS-00001`, …) from the Postgres sequence `customer_code_seq`. A create that rolls back leaves a gap, which is harmless.
- **The duplicate-mobile warning is enforced by the server.** A create whose mobile is already on a non-deleted customer in the organization answers `409 DUPLICATE_MOBILE` until it is resent with `confirmDuplicateMobile: true`. The form then lists who has the number (`GET /api/customers?mobile=`). The confirmation is recorded on the audit entry.

**Mobile numbers** are accepted as typed (`98765 43210`, `098765-43210`, `+91 98765 43210`) and stored as E.164 (`+919876543210`). Only Indian mobiles (starting 6–9) are accepted.

**The sector is never sent.** It is copied from the chosen line, which must be one the caller can see and must be active. 1–5 references are accepted at onboarding.

**Screens:**

- `/customers`: the list, with a search box for every role (`?q=`) and a line filter for Admins.
- `/customers/new` (S-10): keyboard-first, validated with the contract's own schema, "Save and add another" keeps the line.
- `/customers/:id`: the profile and references. Accounts and collections are stated as not yet available.
- `/customers/:id` (S-09) shows the totals above the tabs, the assigned Senior and Junior in the details, and a Collections tab with the whole history beside the Accounts tab (US-022). It also carries a Transfer action for Admin+ (US-023), stating that the new line collects from today and past collections do not move, and shows a line history once there has been a transfer.
- `/customers/:id/edit` (US-021): the record as saved, validated with the contract's schema; reached from an Edit action on the profile, shown to Admin+.

**Not built:** the trigram index for name search, soft delete and assigning a customer to a particular Junior (no model for it; a Junior sees their whole line, decided 2026-09-13).

---

## Risks

| Risk                                                  | Mitigation                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Duplicate customers created over time                 | Warn on matching mobile; periodic duplicate report                               |
| Line transfer mid-account confuses attribution        | BR-15 freezes collection attribution; the transfer screen states this explicitly |
| Customer marked inactive stops collection by accident | Status has no effect on collection; only account status does                     |
