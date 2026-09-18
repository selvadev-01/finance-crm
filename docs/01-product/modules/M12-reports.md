# M12 — Reports

**Purpose:** answer specific questions over a chosen date range, with filters.

**Source:** PDF §14, §20, §22, and Appendix A's "Reports" row.

---

## Scope

**In:** line-wise, sector-wise, collection, investment and overdue reports; filtering, sorting, pagination.

**Out:** fixed-layout dashboards (M11). Export to Excel/PDF is **deferred to Phase 2**.

---

## Owns no entities

Read-only across M05, M07, M08, M09.

---

## Reports

### Line-wise report (§14)

Per line: sector, Senior, Juniors, customer count, account count, account value, invested, profit, expected daily collection, actual daily collection, pending collection, extra collection, completed accounts.

This is §14 verbatim — the PDF specifies the columns precisely, and they are implemented as listed.

### Line overview (§20)

Who handles each line: Senior, Junior count, customer count. Lighter than the line-wise report; used for staffing questions rather than money.

### Investment overview (§22)

Per line and overall: account amount, invested amount, profit. Figures come from the ledger (M09), not from summing `account_loan` rows. **Built — see [as built](#as-built--investment-overview-us-085-2026-09-18).**

> Summing account rows would give the _contracted_ position. The ledger gives the _actual_ one — profit recognised on money received, not money promised. §22's example totals are contracted values; the report shows both, labelled, because the difference is exactly what the Super Admin needs to see.

### Collection report

Date range, filterable by sector, line, Junior, classification. **Built — see [as built](#as-built--collection-report-us-086-2026-09-18).** Per line: expected against collected with the range's variance, and BR-08's classification of every entry behind it.

The workhorse report — used to investigate a specific line's bad week, or a specific Junior's pattern.

> Its rows are lines, not collections: the per-collection list the first draft described is `GET /api/collections` (S-16), which already pages through exactly those rows. The reasoning is in the as-built section.

### Overdue report

Accounts past `targetCompletionDate` with outstanding remaining, ordered by outstanding and days overdue. Includes days elapsed since the last collection. **Built — see [as built](#as-built--overdue-report-us-087-2026-09-18).**

> Not requested in the PDF, and necessary: balance-driven completion (BR-05) means accounts run past their target date rather than closing, so overdue accounts need somewhere to be visible or they become invisible.

### Discrepancy report

Cash discrepancies by line, Junior and date, traceable to the specific handover and its denomination breakdown (M08).

---

## Design

**Every report is date-bounded.** No unbounded query exists — a report with no date range defaults to the current month.

**Paginated where the rows are unbounded.** A report with one row per line (line-wise, line overview, investment and — as built — collection) is bounded by the line count and returns every row with its totals; the reports whose rows are accounts (overdue, discrepancy) page through the API's cursor, as the collection list does.

> An unbounded report over 1,500 accounts and years of collections is a slow query that will be written once and run every morning. Bounding by default costs nothing and removes the failure mode.

**Filters are applied server-side** and scoped by role before any filter is honoured (M02). A Senior filtering by "all lines" gets their own line.

**Reports read the same data as dashboards.** There is no separate reporting store, no ETL, and no eventual consistency between the two.

---

## Role access

Per Appendix A:

| Report        | Super Admin | Admin |  Senior  | Junior |
| ------------- | :---------: | :---: | :------: | :----: |
| Line-wise     |      ✓      |   ✓   | own line |   —    |
| Line overview |      ✓      |   ✓   | own line |   —    |
| Investment    |      ✓      |   ✓   | own line |   —    |
| Collection    |      ✓      |   ✓   | own line |   —    |
| Overdue       |      ✓      |   ✓   | own line |   —    |
| Discrepancy   |      ✓      |   ✓   | own line |   —    |

Appendix A's "Limited" for Senior is interpreted throughout as **their own line only**.

> **As built (US-084, US-085, US-086):** every report is guarded by one permission, `report.view` (Super Admin, Admin, Senior), with the rows decided by scope — a Senior's report covers their current line, and another line's id is `404`. A Junior is `403`. Invested and profit are on a Senior's own line, as the [money-visibility table](../rbac-matrix.md#money-visibility-m09-m11-m12) grants them; the investment overview shows a Senior their own line's invested, profit and profit earned on the same grant. A filter naming a person is scoped the same way: the collection report's collector must be someone the caller can see, or it is `404`.

---

## Deferred to Phase 2

**Excel and PDF export.** Deliberately excluded from v1 scope.

> Export is genuinely useful and genuinely not on the critical path. Nothing in the daily operation depends on it, and adding a rendering pipeline before the figures themselves are trusted would be work spent on presenting numbers nobody has verified yet. Once the ledger reconciles for a month, export becomes worth building.

Also deferred: scheduled report delivery by email, and custom report builders.

---

## As built — line-wise report (US-084, 2026-09-18)

`GET /api/reports/line-wise?from=&to=&sectorId=&lineId=`, in `apps/api/src/reports/`, guarded by the existing `report.view` (Super Admin, Admin, Senior — the first route to use it), read-only and unaudited. Per line it returns §14's columns: sector, Senior and Juniors (assigned on the range's last day), customers, accounts, active and completed accounts, account amount, invested and profit, and the range's expected, collected, pending and extra collection — with a `totals` row that is the rows summed exactly.

**The pattern the later reports follow**, established here:

- **`reports/report-range.ts`** resolves the bounds for every report: blank `to` is today, blank `from` is the first day of `to`'s month, a `to` after today is `422 DATE_IN_FUTURE`, and a reversed range or one over `MAX_REPORT_DAYS` (93, as the collection list) is `400 INVALID_DATE_RANGE`. `MAX_REPORT_DAYS` lives in the contract, so the screen refuses the same range the API does.
- **No new readers for money.** The figures come from the readers the dashboards share: `cash/line-day-figures.ts` (`lineRangeFigures`, added here) and `dashboards/business-figures.ts` (`readCustomersByLine`, `readAccountCountsByLine`, `readDisbursedTotalsByLine`, added here — the per-sector readers US-081 uses are now folded from the per-line ones, and since US-085 those fold in turn from a per-account `readDisbursedByAccount`). A report over one day therefore equals S-07, S-20 and US-081 for that day, and a test holds it so. A report that needs a figure no dashboard shows adds its reader **there**, beside the others, and a test ties it to the figures already in use.
- **BR-16 per line, per day.** A range's pending and extra are the daily shortfalls and surpluses summed, not the net of the range: ₹100 short on Monday and ₹100 over on Tuesday is pending ₹100 and extra ₹100, never zero. `lineRangeFigures` reads the range in one pass with the day close's own predicates, and a test proves it equals the per-day sum to the paisa.
- **Scope before filters** (M02). Lines come from `lineScope`, so a Senior's "all lines" is their own line; a `sectorId` or `lineId` outside scope — or in another organization — is `404`, identical to a missing one. A Senior sees invested and profit **for that line**, which is the matrix's "own line" cell, not a hidden column.
- **Structure is "now", the range bounds the collections.** Customers, accounts and the ledger amounts are read as of now for the accounts the line holds today (each on its customer's current line); only the collection figures are bounded by the dates. §14 describes a line's standing, and a customer's transfer moves their book while their past collections stay on the line that recorded them (BR-15).
- **Nulls, never zeros** (S-07). Each group — collections, customers and accounts, ledger amounts — is read on its own; one that fails is `null` on every row and in the totals, and the screen leaves those columns out and says so. The lines themselves failing makes `lines` and `totals` null.

**Which lines are listed:** active lines in scope and filter, by code, plus an inactive line that carried money in the range or was asked for by `lineId`.

**Web:** `/reports/line-wise` (S-22) — From / To / Sector / Line filters kept in the URL, four stats for the range's expected, collected, pending and extra, then the table with a totals footer. `/reports` is an index of the reports that exist, and each later report story adds its entry; the sidebar's **Reports** item points there (see [navigation-ia](../../05-ux/navigation-ia.md#navigation-by-role)).

**Not built:** CSV and Excel export (Phase 2, below — the design's "Export CSV" button is deliberately absent), the line overview (§20), and drill-down from a line's figures into its customers (the line page is the existing S-12).

## As built — investment overview (US-085, 2026-09-18)

`GET /api/reports/investment?from=&to=&sectorId=&lineId=`, in `apps/api/src/reports/investment-report.service.ts`, on the same `report.view`, read-only and unaudited. It follows the pattern above with nothing added to it: the same `reportRange` bounds, scope before filters with an out-of-scope sector or line `404`, lines by code with the totals row the rows summed exactly, and a group that fails `null` everywhere rather than zero.

**Every figure comes from the ledger** (§22's point — summing `account_loan` would give the contracted position twice over), in two groups:

- **`position`, as of now.** §22's `accountAmount`, `invested` and `profit` are the DISBURSEMENT postings for the accounts the line holds today — the identical figures the line-wise report and the dashboards show, because `readDisbursedTotalsByLine` now folds from a per-account `readDisbursedByAccount` and this report folds from the same read. Against them: each account's `LOAN_RECEIVABLE` **balance** is the money still out, `A −` that balance is the money returned, and the profit earned on it is BR-18's `round(collected × P / A)` — `recognisedProfit` from `packages/domain`, applied **per account** and then summed, which is exactly the figure that account's postings have moved into `EARNED_PROFIT` (the per-collection deltas telescope). `profit − profitEarned` is what `UNEARNED_PROFIT` still holds. Rounding per line instead of per account would drift by a paisa an account.
- **`range`, what the period did.** The DISBURSEMENT, COLLECTION and ADJUSTMENT postings whose business date falls between `from` and `to`: accounts disbursed with their `A`, `I` and `P`, the money returned, and the profit recognised — the ledger's own deltas, read rather than recomputed, so a correction's negative posting reduces both. Every one of those transactions carries exactly one `LOAN_RECEIVABLE` entry, and that receivable names the account, so a transaction lands on the line holding that account now whatever the other side of it touched.

**Decisions §22 left open**, each recorded here because the figures are only readable if the rule is known:

- **The position is all time; only the two dated columns are bounded.** §22 describes a line's book, and US-084 already reads structure as of now.
- **"Returned" is money against the receivable**, so a mid-term account's pre-Rasi catch-up (US-030a) counts on its entry day, and the attribution is the account's **current** line — not the recording line. BR-15 freezes a _collection's_ line, which is what the line-wise report's "collected" uses; a receivable belongs to the book that holds it.
- **Write-offs are not posted anywhere yet** (M09), so nothing here reads `WRITE_OFF`. When they are, they will credit a receivable and must be split out of "returned".
- **A receivable balance outside `0 … A`** would mean the ledger and the account disagree, which the nightly reconciliation reports (US-095); the report clamps to the nearest position rather than refusing the whole figure.

**Web:** `/reports/investment` — From / To / Sector / Line in the URL, four stats for the period (invested, returned, profit earned, accounts disbursed), then per line: accounts, account amount, invested, profit, still out, returned, profit earned, profit to earn, and the period's invested and earned, with a totals footer. US-084's screen moved onto a shared `app/(console)/reports/report-parts.tsx` — the four filters, the range rule the API enforces, and the loading, `404`, refusal and error states — so both report screens behave identically and the next report starts from it.

**Not built:** export (Phase 2), per-sector rows (sector is a filter and a column; "overall" is the totals row), and drill-down from a line into its accounts.

## As built — collection report (US-086, 2026-09-18)

`GET /api/reports/collection?from=&to=&sectorId=&lineId=&collectedByUserId=&classification=`, in `apps/api/src/reports/collection-report.service.ts`, on the same `report.view`, read-only and unaudited. It follows the pattern above — the same `reportRange` bounds, scope before filters, lines by code with the totals row the rows summed exactly, and a group that fails `null` everywhere rather than zero — and adds the collector filter and BR-08 to it.

Per line, two groups:

- **`collections`, the comparison.** `lineRangeFigures` in `cash/line-day-figures.ts` — the same reader the day close and the line-wise report use, now also returning `missed`: expected from the slots due in the range (each on its account's customer's **current** line, as the day close reads them), collected by `collection.lineId` frozen at write (BR-15), BR-16's `pending` and `extra` taken **per line per day** so one day's surplus never hides another's shortfall, the range's signed `variance` (`collected − expected`, which is what "expected versus collected" means on a report), and the slots the close marked MISSED (BR-09 — a visit that did not happen, never a `NO_PAYMENT`).
- **`classification`, BR-08.** `readClassificationByLine` in `dashboards/business-figures.ts` groups the range's CONFIRMED entries by `entryType` and `classification`: `correct`, `low`, `extra` and `noPayment` each as a count and an amount, `recorded` visits with their total, and approved corrections (US-044) apart in `adjusted` with the signed difference each moved. It reads the same rows on the same business dates as `collected`, so **unfiltered, the five amounts add up to `collected` to the paisa** — a Tier 1 test holds it on every row.

**Decisions the story did not settle**, each recorded here because the figures are only readable if the rule is known:

- **The report is line-shaped, not a list of collections.** The design above says the collection report's rows are collections, paged; they already are — `GET /api/collections` (S-16) is exactly that list, date-bounded and cursor-paged. Duplicating it under `/api/reports` would give two definitions of one query, so the report is the aggregate the list cannot show: the comparison and the breakdown, per line, with a totals row. Drill-down into the individual entries belongs on S-16.
- **BR-08 is read as written, never re-derived.** Classification is computed against the expected amount of the day it was recorded, and that amount moves as the account progresses (BR-07), so each visit keeps the class it was written with and a correction stands in `adjusted` rather than reclassifying the visit.
- **`missed` is a schedule fact, so it sits with `expected`.** A slot belongs to a line and a day, not to a Junior or a class; the collector and classification filters therefore narrow `classification` only, and the whole comparison stays the line's own. The screen says so whenever either filter is on.
- **The classification filter takes BR-08's four stored classes only.** `MISSED` is the absence of a row, so it is not a value a filter can select; it is a column, always shown.
- **A collector outside scope is `404`**, decided by `staffScope` on today's business date — the staff directory's own rule — so a Senior asking after another line's Junior gets the answer a name that never existed gets.

**Web:** `/reports/collection` — From / To / Sector / Line / Collected by / Class in the URL, four stats for the period (expected, collected with its variance, pending, extra), then per line: expected, collected, variance, the four class counts and missed, with a totals footer carrying the entry count and any corrections. It is built on the shared `app/(console)/reports/report-parts.tsx`, whose `ReportFilterBar` gained an `extra` slot so a report's own filters sit after the four every report shares, in the same order on every screen.

**Not built:** export (Phase 2), per-collection rows inside the report (S-16 is that list), and a per-Junior row shape — the collector is a filter, not a row.

## Risks

| Risk                                    | Mitigation                                                       |
| --------------------------------------- | ---------------------------------------------------------------- |
| Unbounded queries as data grows         | Mandatory date bounds, server-side pagination                    |
| Report figures disagree with dashboards | Same data source, same aggregation functions, shared query layer |
| Scope bypassed via filters              | Scoping applied before filters, tested at API level              |
| Contracted vs actual profit confusion   | Both shown, explicitly labelled                                  |
