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

Collection status per §19 — how many sectors tallied, how many have extra, how many have low collection. _"Tally Completed 8; Extra Collection 2; Low Collection 2."_

A sector's tally status derives from its lines' `day_close` states (M08): all lines `TALLIED` means the sector has tallied. How it was built is under [as built](#as-built--sector-comparison-us-081-2026-09-17).

---

## Admin dashboard (§21)

Operational rather than financial: new customers, active customers, completed accounts, total accounts, sector- and line-wise breakdowns, expected/actual/pending/low/extra collection, Senior and Junior assignments, total investment and profit. How each is computed is under [as built](#as-built--admin-operational-dashboard-us-082-2026-09-17).

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

| Level    | Super Admin | Admin |  Senior  | Junior |
| -------- | :---------: | :---: | :------: | :----: |
| Business |      ✓      |   ✓   |    —     |   —    |
| Sector   |      ✓      |   ✓   |    —     |   —    |
| Line     |      ✓      |   ✓   |   own    |   —    |
| Profit   |      ✓      |   ✓   | own line | **—**  |

Aggregates are computed from scoped queries, so a Senior's line dashboard cannot leak a business total through a sum.

---

## As built — Super Admin business overview (US-080, 2026-09-17)

`GET /api/dashboards/overview?date=YYYY-MM-DD` in `apps/api/src/dashboards/business-overview.service.ts`, contract `dashboardContract.getOverview`. It defaults to today, and a date after today is `422 DATE_IN_FUTURE`. It is guarded by `money.businessTotals`, so no new permission was added. It is read-only and not audited. The web screen is S-07 at `/dashboard` for Super Admins.

**Admin.** S-07 says an Admin "sees the same with settings absent", and the matrix gives Admins business totals, so the endpoint serves Admins too. The screen has no settings on it, so there is nothing to hide. Admins still land on S-20, as the [landing table](../../05-ux/navigation-ia.md) says, because their question is today's work rather than the business's shape.

**Every figure, and where it comes from.** The day's money, the account counts and the ledger totals are read by `dashboards/business-figures.ts`, the same code S-20 uses. A test holds the two dashboards equal for the same date.

| Figure (§17)                           | Source                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sectors, lines                         | Active sectors and lines in scope, now                                                                                                               |
| Customers                              | Customers not deleted, any status, now                                                                                                               |
| Active / completed accounts            | Accounts by status, all time (as S-20)                                                                                                               |
| Total account amount, invested, profit | The ledger's `DISBURSEMENT` postings, all time: `A` debited to `LOAN_RECEIVABLE`, `I` credited to `CASH_AT_OFFICE`, `P` to `UNEARNED_PROFIT` (BR-18) |
| Today's expected, actual               | Per line from `cash/line-day-figures.ts` (as S-05 and S-20), with collections by `collection.lineId` (BR-15), summed                                 |
| Pending, extra                         | BR-16 shortfall and surplus **per line**, then summed (as S-20)                                                                                      |
| Low                                    | The count of `ORIGINAL`, `CONFIRMED` collections on the date classified `LOW` (BR-08), as S-20 counts it. The extra count comes with it              |

**Sectors (§23).** Each sector row sums its lines: expected, collected, shortfall and surplus (per line, then summed), and low and extra counts. Only sectors that have a line are listed, in code order. The sector count still includes a sector with no lines.

**Sector tally (§19).** A sector's day rolls up the `day_close` states of its **collecting lines**: active lines whose day is a working day for their sector. These are the lines S-20 counts as "to close".

- `TALLIED`: every collecting line is TALLIED.
- `CLOSED`: every one is CLOSED or TALLIED, but not all are TALLIED.
- `OPEN`: at least one is OPEN or REOPENED.
- `NO_COLLECTIONS`: the sector has no collecting line that day (a Sunday, a holiday, or no active line).

Each row also carries how many of its lines are to close, closed and tallied. The §19 summary counts only the sectors that are collecting. It gives how many tallied, how many had extra (surplus above zero) and how many had low collection (shortfall above zero).

**S-07's partial failure.** Holidays, lines, structure, accounts and totals are each read in their own `try`. A group that fails is logged and returned as `null`. Today's money, the sectors and the tally are built from the lines, so they are `null` when the lines are. `setupNeeded` is `null` when the structure is unknown. It is `true` only when the organization has no sector or no line at all, and then the screen shows a setup prompt instead of zeros.

**Drill-down.** Today's four money figures and "sectors tallied" jump to "Sectors today". The low count and the table's footer open `/collections` for the date. Sectors, lines and customers open their lists. Each sector row opens the sector page, and from there a line, its day close and its collections. Accounts, account amount, invested and profit have no page to open yet (reports, M12), so they are not links.

**Not built:** Export (Phase 2), and the design's "Portfolio Discrepancy Watch" and branch name (Stitch inventions).

---

## As built — Sector comparison (US-081, 2026-09-17)

`GET /api/dashboards/sectors?date=YYYY-MM-DD` in `apps/api/src/dashboards/sector-comparison.service.ts`, contract `dashboardContract.getSectors`. It defaults to today, and a date after today is `422 DATE_IN_FUTURE`. It is guarded by `money.sectorTotals` (Super Admin, Admin), the matrix's "Sector totals" row, which no route used before. It is read-only and not audited. The web page is `/dashboard/sectors`.

**One date, not a range.** §19's tally is the state of a day, so the comparison is read for one business date, as S-07 is. Nothing is summed across days. Lines, customers and the ledger amounts are as of now, as on S-07.

**Which sectors.** Every active sector, and an inactive sector that still has lines, in code order. A sector with no line that day shows zeros and `NO_COLLECTIONS`. An inactive sector that never had a line is left out.

**Every figure, and where it comes from.** All of them are read by `dashboards/business-figures.ts`, which US-080 also reads. Since US-084 the per-sector structure and ledger readers are folded from per-line ones (`readCustomersByLine`, `readAccountCountsByLine`, `readDisbursedTotalsByLine`), which the line-wise report reads directly — so a sector is its lines by construction, not by a second query. Since US-085 the ledger amounts fold one level further, from a per-account `readDisbursedByAccount`, so the investment overview's per-account profit arithmetic (BR-18) starts from the same rows a sector total does.

| Figure (§18, §19)                | Source                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lines                            | Active lines of the sector, now. Summed, they are S-07's line count                                                                                                                                               |
| Customers                        | Customers not deleted, by the sector of their **current** line (§23 rolls a customer up through their line)                                                                                                       |
| Account amount, invested, profit | The ledger's `DISBURSEMENT` postings (BR-18), as S-07 reads them. Each posting names its account (`sourceTable = account_loan`), and the account belongs to its customer's current line's sector (`accountScope`) |
| The day's money and tally        | US-080's sector row, from the same function: expected and collected per line with collections by `collection.lineId` (BR-15), BR-16 per line, the §19 tally over the collecting lines                             |
| Summary (§19)                    | Of the sectors collecting that day, how many tallied, had extra (surplus above zero) and had low collection (shortfall above zero). Equal to S-07's                                                               |

So a transferred customer's accounts move to the new sector, while the day's collections stay with the line they were recorded under.

**The business row.** The response also carries S-07's own business-wide reads: active sectors, lines and customers, the ledger totals, and the day's money. The sector rows add up to them to the paisa, and a test holds them to it and to US-080 for the same date.

**S-07's partial failure.** Holidays, lines, sectors, business structure, sector structure, business totals and sector totals are each read in their own `try`. A group that fails is `null` on every row, never `0`. A failed sector list makes the rows and the tally `null`. The page leaves out an unknown group's columns and says which ones.

**The page.** The breadcrumb reads Dashboard / Sector comparison, and a date picker (today or earlier) is kept in the URL as `?date=`. Three figures show §19's status: tallied, extra collection and low collection, each "n of m" collecting sectors. Below them is a table with one row per sector: its lines, customers, account amount, invested and profit, then the day's expected, collected, low (red when above zero), extra, and a day badge with "n of m lines tallied". An inactive sector carries a badge. The table's footer shows the business figures. Each sector opens its page. The page is linked from S-07's "Sectors today", from S-20's "Sectors" and from the Sectors list. It is not a sidebar item. A Senior who types the address sees "not permitted", and the API answers `403`.

**Not built:** Export (Phase 2), and a comparison over a date range (that is the collection report, US-086).

---

## As built — Admin operational dashboard (US-082, 2026-09-17)

`GET /api/dashboards/operations?date=YYYY-MM-DD` in `apps/api/src/dashboards/`, contract `dashboardContract.getOperations`. It defaults to today, and a date after today is `422 DATE_IN_FUTURE`. It is guarded by `money.businessTotals` (Admin, Super Admin), so no new permission was added. It is read-only and not audited. The web screen is S-20 at `/dashboard`.

**Every figure, and where it comes from.** All are computed live from scoped queries (`lineScope`, `customerScope`, `accountScope`, `collectionScope`, `holidayScope`):

| Figure (§21)                         | Source                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expected, per line                   | Σ `expectedAmount` of slots due on the date, not `CANCELLED`, by the customer's current line — `cash/line-day-figures.ts`, the same function the day close (S-05) reads              |
| Actual (collected), per line         | Σ `CONFIRMED` collections on the date by `collection.lineId` (BR-15), adjustments included — same function                                                                           |
| Pending / extra collection           | BR-16 shortfall / surplus **per line**, then summed, so one line's surplus never hides another's shortfall                                                                           |
| Low / extra collection (counts)      | `ORIGINAL`, `CONFIRMED` collections on the date classified `LOW` / `EXTRA` (BR-08), as S-05 lists them                                                                               |
| Lines to close / not closed          | Active lines with a working day (not Sunday, not a holiday for their sector); not closed = `day_close` absent, `OPEN` or `REOPENED`                                                  |
| Pending approvals                    | `PENDING_APPROVAL` adjustments; `awaitingYou` excludes an Admin's own requests; on the line dashboard a Senior's own are counted, since they may decide them (US-044)                |
| New customers                        | Customers created on the date, as an Asia/Kolkata day (`businessDayStart`)                                                                                                           |
| Active customers                     | `ACTIVE`, not deleted, holding at least one `ACTIVE` account                                                                                                                         |
| Total / active / completed accounts  | Accounts by status, all time                                                                                                                                                         |
| Total investment and profit          | The ledger's `DISBURSEMENT` postings: credits to `CASH_AT_OFFICE` (`I`) and `UNEARNED_PROFIT` (`P`), BR-18, all time                                                                 |
| Sector-wise and line-wise breakdowns | Per line: sector, Senior and Junior count on the date, active accounts (by the customer's current line), expected, collected, missed slots, day status. Per sector: the lines summed |

**Needs attention**, most urgent first:

1. Handovers `DISPUTED` on a day that has not tallied since. A fresh count that reconciles the day clears the item; at most 20 are listed.
2. Lines with `MISSED` slots on the date.
3. For a past date only, working lines whose day is not closed. Today's open days are work in progress and appear only in the count.
4. Waiting corrections.
5. Active lines with no Senior on the date (§15).
6. Active lines that hold active accounts but have no Junior on the date.

**S-07's partial failure.** Holidays, lines, approvals, customers, accounts, investment and disputes are each read in their own `try`. A group that fails is logged (`Dashboard figures unavailable: <group>`) and returned as `null`. Figures built from the lines (today's totals and the sectors) are `null` when the lines are. The attention list is `null` if any of its inputs is, because a partial list would read as "all clear". The screen shows `null` as "—" with "Couldn't be worked out just now".

**Who lands on it.** Admins land on it. Super Admins land on their overview (S-07, [above](#as-built--super-admin-business-overview-us-080-2026-09-17)). Seniors land on S-19 ([below](#as-built--senior-line-dashboard-us-083-2026-09-17)).

**Shared figures.** The lines, the account counts and the ledger totals are read by `dashboards/business-figures.ts`, which the business overview (US-080) reads too.

**Not built:** drill-down beyond the links to existing pages (a line, a sector, its day close, the approval queue), and a last-updated refresh beyond reloading the page.

---

## As built — Senior line dashboard (US-083, 2026-09-17)

`GET /api/dashboards/line?date=YYYY-MM-DD&lineId=…` in `apps/api/src/dashboards/line-dashboard.service.ts`, contract `dashboardContract.getLine`. It defaults to today, and a date after today is `422 DATE_IN_FUTURE`. It is guarded by `money.lineTotals` (Admins, and a Senior for their own line), so no new permission was added. It is read-only and not audited, and it returns no invested or profit figures. The web screen is S-19 at `/dashboard` for Seniors.

**Which line.** Without `lineId`, it is the caller's current line: the assignment in effect on today's business date (`RequestContext.currentLineId`), whatever date is shown. A Senior with no line today gets `{ state: "NO_LINE" }`, which is an empty state, not an error. An Admin who names no line gets the same. A `lineId` must be in scope (`lineScope`), so a Senior naming another line gets the same `404 LINE_NOT_FOUND` as a line that does not exist (M02).

**Every figure, and where it comes from.**

| Figure                                             | Source                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expected, collected, cash received, discrepancy    | `DayCloseService.view` (S-05), which reads `cash/line-day-figures.ts` like S-20 does. The dashboard reshapes that view and never recomputes these figures        |
| Shortfall / surplus                                | BR-16 for the one line: expected − collected where positive, else collected − expected                                                                           |
| Day status, closed by and when, working day or not | The day close view                                                                                                                                               |
| Handovers waiting / disputed; "handed over" yet    | The day close's Junior → Senior handovers. Before any is acknowledged, the screen says "not handed over yet" rather than showing a shortage, as S-05 does        |
| Juniors: entries, collected, phone sync            | The day close's Juniors: assigned on the date or who collected on it, with the phone's last queue report                                                         |
| Needs a look                                       | The day close's exceptions: LOW, EXTRA and NO_PAYMENT originals, and MISSED or not-yet-visited slots                                                             |
| Pending approvals                                  | `PENDING_APPROVAL` adjustments on the line (`collectionScope`), with `awaitingYou` excluding the caller's own requests (US-044)                                  |
| Overdue                                            | ACTIVE, outstanding > 0, target date before today (BR-05's predicate, the same as `OverdueService`), computed live. Most outstanding first, then longest overdue |
| Nearing completion                                 | ACTIVE, not overdue, outstanding ≤ 5 × the daily amount. Least outstanding first                                                                                 |

Both account lists are **as of now**, whatever date is shown: a target date moves with every collection, so an earlier day's list cannot be reconstructed. Each carries its full `total` and at most 20 `items`. Accounts follow their customer's current line (`accountScope`).

**S-07's partial failure.** The day, the approvals and the accounts are each read in their own `try`. A group that fails is logged and returned as `null`, and the screen shows "—".

**Not built from the design:** "Export run sheet", "Ping device", "Clear exceptions guide", the per-Junior "assigned slots" column (the data model has no customer-to-Junior assignment, so every Junior on a line has every slot), the reason / note column, the per-row actions (Acknowledge, Follow up, Reschedule, Approve extra) and the footer. Rows link to the collection or the account instead. The day close is one link away ("Open day close").

---

## As built — dashboard trend (2026-09-19)

`GET /api/dashboards/trend?date=&days=&lineId=` feeds the "Collections trend" chart on S-07, S-20 and S-19 ([ADR-0015](../../02-architecture/adr/0015-console-layout-and-in-house-charts.md)). The service is `src/dashboards/dashboard-trend.service.ts`.

- **Figures.**
  - Each point is one working day's expected (BR-16) and collected (BR-15, adjustments included), summed over the caller's lines.
  - They are read through `lineDailyFigures` in `cash/line-day-figures.ts`: the per-(line, day) grain `lineRangeFigures` now folds from, with the day close's own predicates. It makes two grouped queries for the whole window, not one per day.
  - A point therefore equals S-20's `today` and Σ `lineDayFigures` for its date to the paisa, and a Tier 1 test holds both.
- **Whose lines.** Scope decides, not role checks:
  - `lineScope(context)` gives Admins and Super Admins every line in the organisation, and a Senior their current line.
  - A Senior with no line gets `lineCount: 0` and no points.
  - A `lineId` outside scope is `404 LINE_NOT_FOUND`, identical to a missing one.
  - The permission is the existing `money.lineTotals`, so no RBAC cell changed.
- **Working days only** (`workingDates` in `business-figures.ts`, M06). A date is left out when it is:
  - a Sunday;
  - a business-wide holiday;
  - a date on which **every** sector of the active lines in view has a holiday.

  A South-only holiday keeps the date on the business trend and removes it from a South line's trend. Holidays are read once for the window through `holidayScope`.

- **Window.**
  - `days` is 30 by default and at most 60 (`TREND_DAYS`, `MAX_TREND_DAYS` in the contract).
  - The series ends on `date`, today by default, or on the working day before it.
  - A future date is `422 DATE_IN_FUTURE`.
- **Failure.** `points` is `null` when it could not be read, never a row of zeros (S-07).
- **Web.**
  - The chart reads the trend on its own (`trend-card.tsx`), so the page's figures never wait for it.
  - The Collected tile's change chip compares the last point with the working day before. It is omitted when the trend is unknown or has one point.
  - S-19 asks for the line it is showing once that line is known.

Tier 1: 7 specs (`test/dashboards/dashboard-trend.service.spec.ts`). HTTP: 2 specs in `dashboards.e2e-spec.ts`, plus the 5 harness cells.

## Risks

| Risk                                       | Mitigation                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Live aggregation degrades as data grows    | Indexes specified; snapshot table as the planned next step with a defined trigger |
| Dashboard figures disagree with the ledger | All money figures derive from ledger-backed values; nightly reconciliation        |
| Scope leaks through aggregates             | Aggregates built on scoped queries, tested at API level                           |
| Thirteen figures overwhelm the phone view  | Ranked layout; drill-down rather than density                                     |
