# M12 — Reports

**Purpose:** answer specific questions over a chosen date range, with filters.

**Source:** PDF §14, §20, §22, and Appendix A's "Reports" row.

---

## Scope

**In:** line-wise, sector-wise, collection, investment and overdue reports; filtering, sorting, pagination.

**Out:** fixed-layout dashboards (M11). Export to Excel and PDF was deferred to Phase 2 and **built early on 2026-09-19** at the business's request — for the reports, the dashboards (M11) and the collection list (S-16); see [as built — export](#as-built--excel-and-pdf-export-2026-09-19). The "Not built: export" notes in the as-built sections below record the state on the day each report shipped.

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

Cash discrepancies by line, Junior and date, traceable to the specific handover and its denomination breakdown (M08). **Built — see [as built](#as-built--discrepancy-report-2026-09-18).**

---

## Design

**Every report is date-bounded.** No unbounded query exists — a report with no date range defaults to the current month.

**Paginated where the rows are unbounded.** A report with one row per line (line-wise, line overview, investment and — as built — collection) is bounded by the line count and returns every row with its totals; the reports whose rows are not (overdue, one row per account; discrepancy, one per line, day and Junior) page through the API's cursor, as the collection list does.

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

> **As built (US-084, US-085, US-086, US-087, discrepancy):** every report is guarded by one permission, `report.view` (Super Admin, Admin, Senior), with the rows decided by scope — a Senior's report covers their current line, and another line's id is `404`. A Junior is `403`. Invested and profit are on a Senior's own line, as the [money-visibility table](../rbac-matrix.md#money-visibility-m09-m11-m12) grants them; the investment overview shows a Senior their own line's invested, profit and profit earned on the same grant. A filter naming a person is scoped the same way: the collection report's collector must be someone the caller can see, or it is `404`.

---

## Deferred to Phase 2

~~**Excel and PDF export.**~~ Built 2026-09-19, ahead of this deferral, because the business asked for it — see [as built — export](#as-built--excel-and-pdf-export-2026-09-19). The original reasoning still stands as a caution: an export presents figures, so it reads through the very same services as the screens and never computes one of its own.

Still deferred: CSV, scheduled report delivery by email, and custom report builders.

---

## As built — Excel and PDF export (2026-09-19)

Every report, every dashboard and the collection list can be downloaded as an Excel workbook or a PDF. Ten routes, each `GET` with the view's own filters plus `format=xlsx|pdf`:

| Route                                                                        | Exports                        | Permission (the view's own) |
| ---------------------------------------------------------------------------- | ------------------------------ | --------------------------- |
| `/api/exports/reports/{line-wise,investment,collection,overdue,discrepancy}` | the five reports               | `report.view`               |
| `/api/exports/collections`                                                   | the collection list (S-16)     | `collection.view`           |
| `/api/exports/dashboards/overview`, `/operations`                            | S-07, S-20                     | `money.businessTotals`      |
| `/api/exports/dashboards/sectors`                                            | the sector comparison (US-081) | `money.sectorTotals`        |
| `/api/exports/dashboards/line`                                               | S-19                           | `money.lineTotals`          |

- **One read, two files.** Each handler calls the same service method as the screen, with the same scope, then a pure builder (`reports/report-exports.ts`, `dashboards/dashboard-exports.ts`, `collections/collection-export.ts`) turns the view into a neutral document of figure lists and typed tables (`exports/export-document.ts`). `xlsx-renderer.ts` (exceljs) and `pdf-renderer.ts` (pdfkit) both draw that one document, so the Excel and the PDF cannot disagree with each other or with the page. Out-of-scope filters are `404` exactly as on the screen, and no RBAC cell changed.
- **Money stays exact.** Amounts reach the renderers as decimal strings. The PDF draws them with Indian grouping from the string. An Excel cell must be an IEEE-754 number by the file format, so `excelNumber` converts each amount and proves it round-trips to the same `NUMERIC(14,2)` value before writing it, refusing the file otherwise — `NUMERIC(14,2)` is at most 14 significant digits and a double holds 15. Money cells carry a two-place number format and dates are real date cells, so a sheet can be summed and filtered.
- **Unknown is not zero** (S-07). A group the view could not read is an empty cell in Excel and a dash in the PDF, with a note on every sheet and page saying so; "nothing here" (an account never visited) is a plain blank, and the two are kept apart in the builders.
- **The whole set, not the page.** The paged views (overdue, discrepancy, the collection list) are read to their end, 200 at a time; past `EXPORT_ROW_LIMIT` (10,000 rows) the export is `422 EXPORT_TOO_LARGE` rather than a silently shortened file, and reading stops as soon as the limit is passed.
- **Recorded.** Every export writes an `audit_log` entry — action `EXPORT` (new), `entityTable` `export`, `entityId` the export's name (`reports/line-wise`), `after` the format, the filters as sent (ids, dates and enums only), the row count and the file name — inside a transaction, **after** the file is rendered and **before** it is sent: a file that fails to render leaves no entry, and no file leaves unrecorded. `audit_log_export_check` ties the action to the pseudo-table and requires an actor and an `after` (migrations `audit_export`, `constraints_audit_export`). The audit log screen filters and labels them ("Exported", "Export").
- **Layout.** Excel: a Summary sheet with the headline figures when the view has any, then one sheet per table with a frozen header and a filter; every sheet opens with the title and what it covers (period, filters, when it was read). PDF: A4 landscape, header row repeated on each page, totals in bold, pages numbered.
- **The contract.** A route may declare `file: true`: its success body is bytes, never parsed, and `ContractResponseInterceptor` passes a `StreamableFile` through untouched. The web calls such a route with `downloadFile` from `@repo/contracts`; errors are still the JSON error body.

**Web:** an **Export** menu (Excel (.xlsx) / PDF) in the header of each of the five reports, the collection list, S-07, S-20, the sector comparison and S-19 (`apps/web/components/export-menu.tsx`), sending exactly the filters on screen. It is disabled while the page's own range is invalid, and on S-19 it appears only once a line is showing.

**Tests:** Tier 1 — cells (grouping, exact Excel numbers, malformed cells refused), both renderers (workbook read back cell by cell; PDF validity and page count), the builders (null against blank, corrections as their own rows), `ExportService` writing the real audit row and writing none when refused or unrenderable, `readAllPages`, and the constraint. HTTP — every route in both formats with its headers and audit entry, a Senior's other line and sector `404` with nothing recorded, Junior `403`, bad format `400`, future date `422`; plus ten RBAC harness rows.

**Limits:** the PDF uses the built-in Helvetica and draws Latin script only; a name in Tamil or another script shows as `?` in the PDF with a note saying so, while the Excel file carries it as written. Not built: CSV, the dashboards' trend chart in the file, and a browser check of the menu.

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

## As built — overdue report (US-087, 2026-09-18)

`GET /api/reports/overdue?sectorId=&lineId=&minDaysOverdue=&sort=&cursor=&limit=`, in `apps/api/src/reports/overdue-report.service.ts`, on the same `report.view`, read-only and unaudited. It keeps the pattern's scope rule — `refuseOutOfScopeFilters` before anything is filtered, an out-of-scope sector or line `404` — and breaks its shape deliberately, in the two ways the design above already anticipated.

**It takes no date range, because it is the position now.** The other three answer a question about a period; this one answers "who is behind today". BR-06 regenerates a schedule's tail after every collection, so the plan as it stands cannot reconstruct who was overdue on an earlier day, and a `from`/`to` pair would invite exactly that question and answer it wrongly. There is therefore no `422 DATE_IN_FUTURE` and no `400 INVALID_DATE_RANGE` here; the response carries `asOf`, today's business date, and every figure is measured to it.

**Its rows are accounts, so it pages.** One row per account through the cursor the collection list uses (`pageSchema`), with `platform/pagination.ts` gaining `toPageBy` — the cursor carries the ordering value **and** the account id, because the order is by target completion date or by outstanding rather than by id. M12 names those two orders and `sort` is exactly them; the id settles ties, so a page boundary can neither repeat nor drop a row.

**Which accounts.** BR-05's three conditions, read from the dates rather than from the `isOverdue` flag: `ACTIVE`, `outstandingAmount > 0`, and `targetCompletionDate` before the cutoff. The cutoff is `apps/api/src/accounts/overdue-cutoff.ts` — today, shifted back by `account.overdueGraceDays` (M15, US-094) — and the report reads that setting exactly as the nightly job (`accounts/overdue.service.ts`) and the Senior line dashboard (M11) do, so the three cannot mean different things at any grace value. An account that fell overdue this morning is still listed before the job next runs.

`minDaysOverdue` narrows that set and never widens it: the two cutoffs are compared and the **earlier** one wins, so "overdue by at least 1 day" cannot pull back an account a grace period is still covering. Both are proved in `apps/api/test/settings/overdue-definition.spec.ts`, which asks the flag, this report and the dashboard the same question at grace 0 and at grace 5.

**Two money figures that are not the same figure.** `outstanding` is `A −` collected, the debt BR-05 completes on. `arrears` is **BR-16's pending, read per account** by `readArrearsByAccount` in `dashboards/business-figures.ts`: for every schedule slot due on or before today, the part of that day's expected amount the day's collections did not cover, summed — taken **per day**, so a day the customer paid double never erases the day they paid nothing. It is `lineRangeFigures`' `shortfall` at a finer grain and with the same predicates (slots not `CANCELLED`, CONFIRMED collections matched on the slot's business date), and a Tier 1 test holds the two equal for a day on which nobody overpaid.

**A Sunday and a declared holiday cannot put anyone in arrears.** They carry no schedule slot at all (BR-02, BR-04), and the figure reads slots — nothing has to exclude them. A worked-example test disburses on Saturday 3 January 2026 with Tuesday 6 declared a holiday: the six-slot account is due on 5, 7, 8, 9, 10 and 12 January, and an account that paid nothing is ₹600 behind over a nine-day span, not ₹1,000.

**Decisions the story did not settle**, each recorded here because the figures are only readable if the rule is known:

- **`arrears` may exceed `outstanding`, and that is the point.** BR-16 clamps each day at zero, so a ₹100 surplus on Wednesday does not cancel Monday's ₹100 shortfall; the two columns answer "what is still owed" and "what the plan asked for and did not get". The screen labels the second **Behind**, never "arrears due".
- **A correction lands on its own business date.** An approved ADJUSTMENT (US-044) carries the date it was approved, not the date of the visit it corrects — the convention every figure that reads collections by date already follows (BR-15, and the collection report's `adjusted`). Reducing a ₹100 visit to ₹40 therefore adds ₹60 to the day the correction landed on, and a test holds it.
- **The last collection is the last _visit_.** The latest CONFIRMED `ORIGINAL` entry, a `NO_PAYMENT` included, with its amount and how many days ago — a customer who was visited yesterday and paid nothing is a different problem from one nobody has seen in a fortnight, and both need to be visible (BR-09).
- **An account belongs to its customer's current line**, as every other per-line figure reads it (`accountScope`), so a transfer moves the account's row to the new line's book.
- **`summary` covers the whole matching set, not the page**, so paging never changes a total. It reads every matching account; the overdue set is by nature small next to the book, and a band that only covered the first page would be worse than none.
- **Nulls, never zeros** (S-07). The arrears behind a row and the summary band are read as separate groups: one that fails is `null` on every row, or `null` for the whole band, and the screen leaves those columns out and says so.

**Web:** `/reports/overdue` (S-24) — Sector / Line / Overdue by / Order by kept in the URL, four stats for the whole set (accounts across N lines, outstanding, behind, longest overdue with the customer's name), then per account: customer with the account code, line, target date, days overdue (badged from seven days, critical from thirty), outstanding, behind, and the last collection with its amount. "Show more" follows the API's cursor. The columns do **not** sort in the browser: the API decides the order and the page, and sorting only the rows already loaded would quietly be a different report. It shares `app/(console)/reports/report-parts.tsx`, whose Sector and Line fields moved into a `ReportScopeFilters` the range-less report uses without the dates.

**Not built:** export (Phase 2 — the design's "Export CSV" button is deliberately absent), per-column sorting in the browser (the two orders are a filter), numbered pages (the cursor is "Show more"), and the `Critical` row highlight the design shows — the days-overdue badge carries that weight.

## As built — discrepancy report (2026-09-18)

`GET /api/reports/discrepancy?from=&to=&sectorId=&lineId=&collectedByUserId=&show=&cursor=&limit=`, in `apps/api/src/reports/discrepancy-report.service.ts`, on the same `report.view`, read-only and unaudited. It keeps the pattern — `reportRange`'s bounds, `refuseOutOfScopeFilters` and `refuseOutOfScopeCollector` before anything is filtered, and a group that fails `null` everywhere rather than zero — and pages like the overdue report, because its rows are unbounded over time.

**The row is one line, one business date, one Junior**, because that is the unit BR-17 defines a discrepancy on: `cash declared − collections recorded`, for that Junior, that date. Each row carries:

- **`collected`** — Σ that Junior's CONFIRMED collections on that line and date, by `collection.lineId` frozen at write (BR-15). An approved correction is an ADJUSTMENT row carrying the original's line and collector on the day it was approved (BR-14), so a correction moves this figure on the day it lands and can close a difference.
- **`cash.handedOver`, `cash.acknowledged`, `cash.awaiting`** — Σ `declaredAmount` of their Junior → Senior handovers for that line-day: pending and acknowledged together, the acknowledged alone (the only cash that has moved, BR-17), and the pending alone. A **disputed** handover is listed but is in no amount: disputed cash never moved (US-063) and the sender counts again.
- **`cash.difference`** — `handedOver − collected`, **signed**. Negative is short, positive is over, and it is never reduced to an absolute value: which way it points is the whole question.
- **`cash.state`** — decided in this order: `DISPUTED`, then `SHORT` / `OVER` when cash has been counted and does not match, then `AWAITING`, then `TALLIED`.
- **`cash.handovers`** — each handover with its stored declared, recorded and signed difference, its note, its dispute note and who acknowledged it.
- **`dayCloseStatus`** — the line's day as it stands, so "resolved" and "still open" are visible beside the money.

**Decisions the design did not settle**, each recorded here because the figures are only readable if the rule is known:

- **Cash still on its way is `AWAITING`, not `SHORT`.** A Junior who has not handed over yet has a difference of minus everything they collected, and calling that a shortage would accuse them at four in the afternoon. The state separates "not counted yet" from "counted and wrong"; the amount is shown either way, because the cash really is outstanding.
- **Only the Junior → Senior hop has rows.** BR-17's formula is written per Junior per date, and the office hop is a Senior's aggregate of what they already acknowledged, not one person's own collections. It stays on S-05 and `/cash`, where it is one line of an already-reconciled day.
- **The denomination breakdown is not repeated here.** BR-17's point is that "one ₹200 note short" is a countable fact, and it is counted on the day-close screen (S-05), which every row links to. Copying nine counts into a report row would give the same fact two homes.
- **`show=unresolved` is the default**, listing every row that is not `TALLIED`; `show=all` adds the days that tallied, which read `0.00` — a real zero, never a null.
- **The summary keeps `short` and `over` apart** as well as their `net`. Netting alone would let a ₹200 shortage on one line read as a clean book against a ₹200 surplus on another, which is the same mistake BR-16 forbids a day at a time.
- **The whole matched range is computed, then paged.** The range is bounded by `MAX_REPORT_DAYS` and the lines in scope, so the cursor names a row — `businessDate|lineId|userId` through `toPageBy` — rather than an offset, the summary covers every matching row rather than the page, and a cursor naming no row is `400 INVALID_CURSOR` instead of silently becoming the first page.

**No new definition of any money figure.** The three readers live beside the others in `cash/line-day-figures.ts` — `readCollectedByCollectorDay`, `readHandoversByCollectorDay` and `readDayCloseStatuses` — with `lineDayFigures`' own predicates, so Σ the Juniors' rows for a line's day is exactly that day close's `collectedTotal`, `cashReceivedTotal` and `discrepancy`. A Tier 1 test holds all three equal.

**Web:** `/reports/discrepancy` — From / To / Sector / Line in the URL, plus Collected by and Show (“Not yet tallied” or “Every day”); four stats for the whole matched set (collected across N days and lines, handed over, short, over with the net as a hint), then one row per line, day and Junior: the Junior with the date beneath, linking to that day's close; line; collected, handed over, acknowledged; the difference as “−₹20.00 short”, “+₹20.00 over” or “Matches”; the cash state as a badge with how many handovers are behind it; and the day's own status. "Show more" follows the API's cursor, and the columns do not sort in the browser. It is built on `app/(console)/reports/report-parts.tsx` with nothing added to it.

**Not built:** export (Phase 2), the office hop as a row, the denomination breakdown inside the report (S-05 has it), and a per-Junior rollup across days — the Junior is a filter and a column, and one bad day is the thing worth seeing.

## Risks

| Risk                                    | Mitigation                                                       |
| --------------------------------------- | ---------------------------------------------------------------- |
| Unbounded queries as data grows         | Mandatory date bounds, server-side pagination                    |
| Report figures disagree with dashboards | Same data source, same aggregation functions, shared query layer |
| Scope bypassed via filters              | Scoping applied before filters, tested at API level              |
| Contracted vs actual profit confusion   | Both shown, explicitly labelled                                  |
