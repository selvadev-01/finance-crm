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

Per line and overall: account amount, invested amount, profit. Figures come from the ledger (M09), not from summing `account_loan` rows.

> Summing account rows would give the *contracted* position. The ledger gives the *actual* one — profit recognised on money received, not money promised. §22's example totals are contracted values; the report shows both, labelled, because the difference is exactly what the Super Admin needs to see.

### Collection report

Date range, filterable by sector, line, Junior, classification. Rows show customer, account, expected, collected, variance, classification, collector.

The workhorse report — used to investigate a specific line's bad week, or a specific Junior's pattern.

### Overdue report

Accounts past `targetCompletionDate` with outstanding remaining, ordered by outstanding and days overdue. Includes days elapsed since the last collection.

> Not requested in the PDF, and necessary: balance-driven completion (BR-05) means accounts run past their target date rather than closing, so overdue accounts need somewhere to be visible or they become invisible.

### Discrepancy report

Cash discrepancies by line, Junior and date, traceable to the specific handover and its denomination breakdown (M08).

---

## Design

**All reports are paginated and date-bounded.** No unbounded query exists — a report with no date range defaults to the current month.

> An unbounded report over 1,500 accounts and years of collections is a slow query that will be written once and run every morning. Bounding by default costs nothing and removes the failure mode.

**Filters are applied server-side** and scoped by role before any filter is honoured (M02). A Senior filtering by "all lines" gets their own line.

**Reports read the same data as dashboards.** There is no separate reporting store, no ETL, and no eventual consistency between the two.

---

## Role access

Per Appendix A:

| Report | Super Admin | Admin | Senior | Junior |
| --- | :-: | :-: | :-: | :-: |
| Line-wise | ✓ | ✓ | own line | — |
| Line overview | ✓ | ✓ | own line | — |
| Investment | ✓ | ✓ | own line | — |
| Collection | ✓ | ✓ | own line | — |
| Overdue | ✓ | ✓ | own line | — |
| Discrepancy | ✓ | ✓ | own line | — |

Appendix A's "Limited" for Senior is interpreted throughout as **their own line only**.

---

## Deferred to Phase 2

**Excel and PDF export.** Deliberately excluded from v1 scope.

> Export is genuinely useful and genuinely not on the critical path. Nothing in the daily operation depends on it, and adding a rendering pipeline before the figures themselves are trusted would be work spent on presenting numbers nobody has verified yet. Once the ledger reconciles for a month, export becomes worth building.

Also deferred: scheduled report delivery by email, and custom report builders.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Unbounded queries as data grows | Mandatory date bounds, server-side pagination |
| Report figures disagree with dashboards | Same data source, same aggregation functions, shared query layer |
| Scope bypassed via filters | Scoping applied before filters, tested at API level |
| Contracted vs actual profit confusion | Both shown, explicitly labelled |
