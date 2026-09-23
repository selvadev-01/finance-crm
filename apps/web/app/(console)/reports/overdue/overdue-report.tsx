"use client";

import {
  exportContract,
  type OverdueAccount as Row,
  type OverdueSort,
  type OverdueSummary,
  reportContract,
} from "@repo/contracts";
import {
  Badge,
  DataView,
  type DataViewColumn,
  FilterBar,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  NothingYet,
  PageHeader,
  Select,
  Stat,
  StatGrid,
} from "@repo/ui";
import type { ReactNode } from "react";

import {
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ExportMenu } from "../../../../components/export-menu";
import { PageTrail } from "../../../../components/page-trail";
import { Pager } from "../../../../components/pager";
import { formatTimestamp } from "../../../../lib/format";
import { canManageOrganisation, seesReports } from "../../../../lib/roles";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { UNAVAILABLE, Unknown } from "../../dashboard/dashboard-parts";
import {
  NoLinesMatch,
  ReportFallback,
  ReportNotPermitted,
  ReportScopeFilters,
  reportScope,
  scopeSummary,
} from "../report-parts";

/**
 * Sector and line, plus the two only this report takes. It has no date range:
 * the overdue report is the position now, not a period (M12).
 */
export const OVERDUE_FILTERS = { sector: "", line: "", overdue: "", sort: "" };

/** "Overdue by" — the buckets a collections office actually asks for. */
const DAY_BUCKETS = ["7", "30", "60"] as const;

const SORTS: { value: OverdueSort; label: string }[] = [
  { value: "daysOverdue", label: "Longest overdue" },
  { value: "outstanding", label: "Largest outstanding" },
];

/**
 * S-24 · Overdue report (US-087): the accounts still active past their target
 * completion date (BR-05), longest overdue first, paged through the API's
 * cursor as the collection list is.
 *
 * Two money figures sit side by side and mean different things. **Outstanding**
 * is `A −` what has been collected: the debt. **Behind** is BR-16's pending
 * read per account — every collection day's shortfall, summed — so a day the
 * customer paid double never erases the day they paid nothing. Sundays and
 * declared holidays carry no schedule slot, so they never put anyone behind.
 *
 * A Senior sees their own line and no sector or line filter (M02). The API
 * orders and pages the rows, so the columns do not sort here — sorting only
 * the rows already loaded would be a different report each time.
 */
export function OverdueReport({
  initial,
}: {
  initial: Partial<typeof OVERDUE_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = seesReports(me.role);
  const manages = canManageOrganisation(me.role);
  const { filters, setFilter, setFilters } = useListState(
    OVERDUE_FILTERS,
    initial,
  );
  const { sectorId, lineId, filtered } = reportScope(filters, manages);
  const minDaysOverdue = (DAY_BUCKETS as readonly string[]).includes(
    filters.overdue,
  )
    ? filters.overdue
    : "";
  const sort = (
    SORTS.some((option) => option.value === filters.sort)
      ? filters.sort
      : "daysOverdue"
  ) as OverdueSort;
  const narrowed = filtered || minDaysOverdue !== "";

  const query = {
    sort,
    ...(sectorId ? { sectorId } : {}),
    ...(lineId ? { lineId } : {}),
    ...(minDaysOverdue ? { minDaysOverdue } : {}),
  };
  const report = usePagedQuery(
    reportContract.getOverdue,
    allowed ? { query } : null,
    { url: true },
  );

  if (!allowed) return <ReportNotPermitted />;

  const clearFilters = () => setFilters({ sector: "", line: "", overdue: "" });
  const summary =
    report.status === "ready" ? (report.data.summary ?? null) : null;

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Reports", href: "/reports" },
              { label: "Overdue" },
            ]}
          />
        }
        title="Overdue accounts"
        actions={
          <ExportMenu route={exportContract.overdueReport} query={query} />
        }
        description={
          manages
            ? "Accounts still being collected past their target completion date (BR-05). “Behind” is every collection day’s shortfall; a Sunday or a holiday is not a collection day."
            : "Your line’s accounts still being collected past their target completion date."
        }
        meta={
          report.status === "ready" ? (
            <>
              <span>as of {formatBusinessDate(report.data.asOf)}</span>
              <span>
                updated {formatTimestamp(report.data.generatedAt, "clock")}
              </span>
            </>
          ) : null
        }
      />

      <FilterBar
        summary={[
          manages ? scopeSummary(sectorId, lineId) : null,
          minDaysOverdue
            ? `${minDaysOverdue}+ days overdue`
            : "any days overdue",
          SORTS.find((option) => option.value === sort)?.label.toLowerCase(),
        ]
          .filter(Boolean)
          .join(", ")}
      >
        {manages ? (
          <ReportScopeFilters
            sectorId={sectorId}
            lineId={lineId}
            setFilter={setFilter}
          />
        ) : null}
        <FilterField label="Overdue by" width="sm">
          <Select
            value={minDaysOverdue}
            onChange={(event) => setFilter("overdue", event.target.value)}
          >
            <option value="">Any</option>
            {DAY_BUCKETS.map((days) => (
              <option key={days} value={days}>
                {days} days or more
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Order by" width="sm">
          <Select
            value={sort}
            onChange={(event) => setFilter("sort", event.target.value)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {report.status === "ready" ? <SetTotals summary={summary} /> : null}

      {report.status === "ready" && report.rows.length > 0 ? (
        <>
          <DataView
            caption="Overdue accounts"
            rows={report.rows}
            getRowId={(row) => row.accountLoanId}
            complete={report.pageCount <= 1}
            columns={columnsFor(manages)}
            footer={
              <Pager list={report} noun="accounts" nounSingular="account" />
            }
          />
        </>
      ) : report.status === "ready" ? (
        narrowed ? (
          <NoMatchingAccounts
            onClearFilters={clearFilters}
            filteredByLine={filtered}
          />
        ) : (
          <NothingYet
            title="Nobody is overdue"
            description={
              manages
                ? "Every active account is still within its target completion date."
                : "Every account on your line is still within its target completion date."
            }
          />
        )
      ) : (
        <ReportFallback
          report={report}
          columns={manages ? 7 : 6}
          onClearFilters={clearFilters}
        />
      )}
    </>
  );
}

/** A filter that matches nothing: a sector or line with no overdue account. */
function NoMatchingAccounts({
  onClearFilters,
  filteredByLine,
}: {
  onClearFilters: () => void;
  filteredByLine: boolean;
}) {
  return filteredByLine ? (
    <NoLinesMatch onClearFilters={onClearFilters} />
  ) : (
    <NothingYet
      title="Nobody is overdue by that long"
      description="Try a shorter period, or every account."
    />
  );
}

/**
 * The whole overdue set, not the page — the API computes it over every
 * matching account, so paging never changes a total. A band it could not read
 * says so rather than showing zeros (S-07).
 */
function SetTotals({ summary }: { summary: OverdueSummary | null }) {
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = summary ? undefined : UNAVAILABLE;
  const longest = summary?.longestOverdue ?? null;
  return (
    <StatGrid columns={4} aria-label="Overdue accounts">
      <Stat
        label="Accounts"
        hint={
          hint ??
          (summary
            ? `across ${summary.lines} ${summary.lines === 1 ? "line" : "lines"}`
            : "")
        }
      >
        {summary ? <span data-numeric>{summary.accounts}</span> : <Unknown />}
      </Stat>
      <Stat label="Outstanding" hint={hint ?? "still owed on these accounts"}>
        {amount(summary?.outstanding)}
      </Stat>
      <Stat
        label="Behind"
        hint={hint ?? "each collection day’s shortfall (BR-16)"}
        tone="critical"
      >
        {amount(summary?.arrears)}
      </Stat>
      <Stat
        label="Longest overdue"
        hint={hint ?? (longest ? longest.customerName : "nobody is overdue")}
      >
        {summary ? (
          longest ? (
            <>
              <span data-numeric>{longest.daysOverdue}</span> days
            </>
          ) : (
            "—"
          )
        ) : (
          <Unknown />
        )}
      </Stat>
    </StatGrid>
  );
}

/** Past 30 days behind the target date, a row is worth stopping at. */
function DaysOverdue({ days }: { days: number }): ReactNode {
  if (days < 7) return <span data-numeric>{days} days</span>;
  return (
    <Badge tone={days >= 30 ? "critical" : "warning"}>
      <span data-numeric>{days}</span> days
    </Badge>
  );
}

function LastCollection({ row }: { row: Row }): ReactNode {
  if (row.arrears === null) return <Unknown />;
  const last = row.arrears.lastCollection;
  if (last === null) return <span className="text-ink-muted">Never</span>;
  return (
    <span className="whitespace-nowrap">
      {formatBusinessDate(last.businessDate)} ·{" "}
      <span data-numeric>{formatCurrency(last.amount)}</span>
    </span>
  );
}

/**
 * The API decides the order and the page, so nothing here sorts: sorting the
 * rows loaded so far would silently mean something else.
 */
function columnsFor(manages: boolean): DataViewColumn<Row>[] {
  const columns: DataViewColumn<Row>[] = [
    identityColumn<Row>({
      header: "Customer",
      name: (row) => row.customerName,
      code: (row) => row.accountCode,
      href: (row) => `/accounts/${row.accountLoanId}`,
    }),
  ];
  if (manages) {
    columns.push(
      valueColumn<Row>({
        id: "line",
        header: "Line",
        value: (row) => row.lineName,
        cell: (row) => `${row.lineCode} · ${row.lineName}`,
      }),
    );
  }
  columns.push(
    valueColumn<Row>({
      id: "target",
      header: "Target date",
      value: (row) => row.targetCompletionDate,
      cell: (row) => formatBusinessDate(row.targetCompletionDate),
    }),
    valueColumn<Row>({
      id: "daysOverdue",
      header: "Days overdue",
      align: "end",
      value: (row) => row.daysOverdue,
      cell: (row) => <DaysOverdue days={row.daysOverdue} />,
      card: "status",
    }),
    moneyColumn<Row>({
      id: "outstanding",
      header: "Outstanding",
      amount: (row) => row.outstanding,
      card: "headline",
    }),
    moneyColumn<Row>({
      id: "arrears",
      header: "Behind",
      amount: (row) => row.arrears?.amount ?? "0.00",
      render: (row) =>
        row.arrears === null ? (
          <Unknown />
        ) : (
          <span data-numeric className="text-critical">
            {formatCurrency(row.arrears.amount)}
          </span>
        ),
    }),
    valueColumn<Row>({
      id: "lastCollection",
      header: "Last collection",
      align: "end",
      value: (row) => row.arrears?.lastCollection?.businessDate ?? "",
      cell: (row) => <LastCollection row={row} />,
    }),
  );
  return columns.map((column) => ({ ...column, enableSorting: false }));
}
