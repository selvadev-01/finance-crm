# M11 — Dashboards

**Purpose:** roll figures up the chain `Customer → Line → Sector → Business`, and answer each role's primary question immediately.

**Source:** PDF §17, §18, §19, §20, §21, §23.

---

## Scope

**In:** aggregation across the four levels, role-specific dashboards, drill-down.

**Out:** the underlying data (M05, M07, M08, M09), filterable reporting (M12).

> **Dashboards vs reports:** a dashboard answers "how are we doing right now" with a fixed layout. A report answers a specific question over a chosen range with filters. Both read the same data; the distinction is fixed-and-fast versus flexible-and-slower.

---

## Owns no entities

Every figure is computed from other modules. This module owns queries, not data.

---

## The rollup chain

§23. Customer-level values aggregate upward, and **only** along this chain:

```
Customer (account) → Line → Sector → Business
```

Line attribution comes from `collection.lineId`, frozen at write time (BR-15) — not from the customer's current line. This is what makes a closed day permanently reproducible.

---

## Super Admin overview (§17)

Thirteen figures: sectors, lines, customers, active accounts, completed accounts, total account amount, total invested, total profit, today's expected, today's actual, pending, extra, low.

**The primary question — expected, collected, shortfall, surplus for today — must be answerable above the fold on a phone.**

> Fitting thirteen figures above the fold is a design problem, not a data problem. The screen specs resolve it by ranking: today's four money figures first at full size, structural counts second, cumulative totals third. Nothing is dropped; the order reflects what is asked most often.

**Every figure drills down.** Tapping today's collected descends to sectors, then lines, then customers, then individual collections.

> A total that cannot be explained is a total that will not be trusted — and trust in the numbers is the entire reason for replacing the spreadsheet. Drill-down is a requirement, not a convenience.

---

## Sector overview (§18, §19)

Comparison across sectors: line count, customer count, account amount, invested, profit, collection status.

Collection status per §19 — how many sectors tallied, how many have extra, how many have low collection. *"Tally Completed 8; Extra Collection 2; Low Collection 2."*

A sector's tally status derives from its lines' `day_close` states (M08): all lines `TALLIED` means the sector has tallied.

---

## Admin dashboard (§21)

Operational rather than financial: new customers, active customers, completed accounts, total accounts, sector- and line-wise breakdowns, expected/actual/pending/low/extra collection, Senior and Junior assignments, total investment and profit.

---

## Senior dashboard

Not in the PDF, derived from §26's "assigned-line monitoring". One line only:

- Today's expected and collected
- Each Junior's progress and sync status
- Open alerts: low, extra, no-payment, missed
- Day close and handover status
- Accounts nearing completion, and overdue accounts

Scoped to the current assignment (M02).

---

## Junior "dashboard" is the route

§25 lists Dashboard for every role. The Junior's is **today's route list**, not an aggregate.

> An aggregate screen would be noise for someone whose entire job is a list of doors. The route is the only screen they need open all day, and it is what they see on launch. This is a deliberate departure from §25's uniform navigation.

---

## Computation strategy

**v1 computes live.** At 1,000 customers and 1,500 accounts this is comfortably within Postgres's reach with the indexes in [`../../03-data/erd.md`](../../03-data/erd.md#indexes-that-matter).

If the Super Admin dashboard exceeds the 2 s p95 target, the first response is a nightly `daily_snapshot` table keyed `(lineId, businessDate)` — **not** a cache layer.

> A snapshot table is debuggable, queryable and reconcilable against the ledger. A cache layer adds an invalidation problem to a system whose figures must be trustworthy, and answers "why is this number wrong" with "it is stale". Deferred rather than pre-built, because premature aggregation is how figures start disagreeing with each other.

---

## Money visibility

Strictly per the [RBAC matrix](../rbac-matrix.md#money-visibility-m09-m11-m12):

| Level | Super Admin | Admin | Senior | Junior |
| --- | :-: | :-: | :-: | :-: |
| Business | ✓ | ✓ | — | — |
| Sector | ✓ | ✓ | — | — |
| Line | ✓ | ✓ | own | — |
| Profit | ✓ | ✓ | own line | **—** |

Aggregates are computed from scoped queries, so a Senior's line dashboard cannot leak a business total through a sum.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Live aggregation degrades as data grows | Indexes specified; snapshot table as the planned next step with a defined trigger |
| Dashboard figures disagree with the ledger | All money figures derive from ledger-backed values; nightly reconciliation |
| Scope leaks through aggregates | Aggregates built on scoped queries, tested at API level |
| Thirteen figures overwhelm the phone view | Ranked layout; drill-down rather than density |
