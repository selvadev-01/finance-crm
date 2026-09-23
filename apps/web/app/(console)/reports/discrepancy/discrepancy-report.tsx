"use client";

import {
  exportContract,
  type DiscrepancyRow as Row,
  type DiscrepancyShow,
  type DiscrepancySummary,
  reportContract,
  staffContract,
} from "@repo/contracts";
import {
  DataView,
  type DataViewColumn,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  NothingYet,
  PageHeader,
  Select,
  Stat,
  StatGrid,
} from "@repo/ui";
import type { ReactNode } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ExportMenu } from "../../../../components/export-menu";
import { Discrepancy, signedCurrency } from "../../../../components/money";
import { PageTrail } from "../../../../components/page-trail";
import { Pager } from "../../../../components/pager";
import { StatusBadge } from "../../../../components/status-badge";
import { formatTimestamp } from "../../../../lib/format";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { canManageOrganisation, seesReports } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { UNAVAILABLE, Unknown } from "../../dashboard/dashboard-parts";
import {
  ChooseRange,
  NoLinesMatch,
  REPORT_FILTERS,
  ReportFallback,
  ReportFilterBar,
  ReportNotPermitted,
  reportCriteria,
} from "../report-parts";

/** The four shared filters, plus the two only this report takes. */
export const DISCREPANCY_FILTERS = { ...REPORT_FILTERS, junior: "", show: "" };

const VIEWS: { value: DiscrepancyShow; label: string }[] = [
  { value: "unresolved", label: "Not yet tallied" },
  { value: "all", label: "Every day" },
];

/**
 * Discrepancy report (M12, BR-17): what each Junior collected on a line and
 * date against the cash they counted out, and which way the difference points.
 *
 * **The sign is the answer.** `−₹20.00 short` and `+₹20.00 over` are different
 * problems and never cancel: the band above the table keeps Short and Over
 * apart, with their net only as a hint. A row links to its day close, where
 * the handover's denomination breakdown is — "one ₹200 note short" is a
 * countable fact, "₹200 short" is an argument.
 *
 * Cash still on its way is **Awaiting**, not Short: a Junior who has not
 * handed over yet at four in the afternoon is not missing money.
 *
 * A Senior gets their own line and no sector or line filter (M02). A group the
 * API could not read leaves its columns out and says so, never zeros (S-07).
 */
export function DiscrepancyReport({
  initial,
}: {
  initial: Partial<typeof DISCREPANCY_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = seesReports(me.role);
  const manages = canManageOrganisation(me.role);
  const { filters, setFilter, setFilters } = useListState(
    DISCREPANCY_FILTERS,
    initial,
  );
  const criteria = reportCriteria(filters, manages);
  const { from, to, sectorId, lineId, filtered, validRange } = criteria;
  const junior = filters.junior;
  const show = (
    VIEWS.some((view) => view.value === filters.show)
      ? filters.show
      : "unresolved"
  ) as DiscrepancyShow;

  const query = {
    from,
    to,
    show,
    ...(sectorId ? { sectorId } : {}),
    ...(lineId ? { lineId } : {}),
    ...(junior ? { collectedByUserId: junior } : {}),
  };
  const report = usePagedQuery(
    reportContract.getDiscrepancy,
    allowed && validRange ? { query } : null,
    { url: true },
  );

  if (!allowed) return <ReportNotPermitted />;

  const clearFilters = () => setFilters({ sector: "", line: "", junior: "" });
  const thisMonth = () => setFilters({ from: "", to: "" });
  const summary =
    report.status === "ready" ? (report.data.summary ?? null) : null;
  const narrowed = filtered || junior !== "";

  let body: ReactNode;
  if (!validRange) {
    body = <ChooseRange onThisMonth={thisMonth} />;
  } else if (report.status === "ready" && report.rows.length > 0) {
    body = (
      <>
        {summary && summary.cash === null ? (
          <FormMessage tone="critical">
            The handovers couldn’t be read just now, so what was counted out is
            left out. The collections are still right.
          </FormMessage>
        ) : null}
        <DataView
          caption="Cash by line, day and Junior"
          rows={report.rows}
          getRowId={(row) =>
            `${row.lineId}-${row.businessDate}-${row.collectedByUserId}`
          }
          complete={report.pageCount <= 1}
          columns={columnsFor(manages)}
          footer={<Pager list={report} noun="days" nounSingular="day" />}
        />
      </>
    );
  } else if (report.status === "ready") {
    body = narrowed ? (
      <NoMatchingDays onClearFilters={clearFilters} filteredByLine={filtered} />
    ) : show === "unresolved" ? (
      <NothingYet
        title="Every day has tallied"
        description={
          manages
            ? "In this range, every Junior’s cash was counted out and acknowledged in full."
            : "In this range, your line’s cash was counted out and acknowledged in full."
        }
      />
    ) : (
      <NothingYet
        title="Nothing was collected"
        description="No collection was recorded in this range, so there is no cash to account for."
      />
    );
  } else {
    body = (
      <ReportFallback
        report={report}
        columns={manages ? 8 : 7}
        onClearFilters={clearFilters}
      />
    );
  }

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Reports", href: "/reports" },
              { label: "Discrepancies" },
            ]}
          />
        }
        title="Cash discrepancies"
        actions={
          <ExportMenu
            route={exportContract.discrepancyReport}
            query={query}
            disabled={!validRange}
          />
        }
        description={
          manages
            ? "What each Junior collected against the cash they counted out, day by day (BR-17). Open a row for the handover and its denomination count."
            : "What your line’s Juniors collected against the cash they counted out, day by day."
        }
        meta={
          validRange ? (
            <>
              <span>
                {formatBusinessDate(from)} – {formatBusinessDate(to)}
              </span>
              {report.status === "ready" ? (
                <span>
                  updated {formatTimestamp(report.data.generatedAt, "clock")}
                </span>
              ) : null}
            </>
          ) : null
        }
      />

      <ReportFilterBar
        criteria={criteria}
        manages={manages}
        setFilter={setFilter}
        extra={
          <>
            <CollectorFilter
              value={junior}
              onChange={(value) => setFilter("junior", value)}
            />
            <FilterField label="Show" width="sm">
              <Select
                value={show}
                onChange={(event) => setFilter("show", event.target.value)}
              >
                {VIEWS.map((view) => (
                  <option key={view.value} value={view.value}>
                    {view.label}
                  </option>
                ))}
              </Select>
            </FilterField>
          </>
        }
      />

      {validRange && report.status === "ready" ? (
        <SetTotals summary={summary} />
      ) : null}
      {body}
    </>
  );
}

/** "Collected by": the Juniors the viewer can see. `""` is everyone. */
function CollectorFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (userId: string) => void;
}) {
  const staff = useApiQuery(staffContract.listStaff, {
    query: { limit: LIST_LIMIT, role: "JUNIOR" },
  });
  return (
    <FilterField label="Collected by" width="sm">
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Every Junior</option>
        {staff.status === "ready"
          ? staff.data.data.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))
          : null}
      </Select>
    </FilterField>
  );
}

/** A filter that matches nothing: a sector, line or Junior with no days. */
function NoMatchingDays({
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
      title="Nothing to account for"
      description="This Junior recorded no collection in the range."
    />
  );
}

/**
 * The whole matching set, not the page — the API sums every matching row, so
 * paging never changes a total. Short and Over stay apart: their net alone
 * would let one line's shortage hide another's surplus.
 */
function SetTotals({ summary }: { summary: DiscrepancySummary | null }) {
  const cash = summary?.cash ?? null;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = cash ? undefined : UNAVAILABLE;
  return (
    <StatGrid columns={4} aria-label="This period">
      <Stat
        label="Collected"
        hint={
          summary
            ? `${summary.rows} ${summary.rows === 1 ? "day" : "days"} across ${summary.lines} ${summary.lines === 1 ? "line" : "lines"}`
            : UNAVAILABLE
        }
      >
        {amount(summary?.collected)}
      </Stat>
      <Stat label="Handed over" hint={hint ?? "counted out by the Juniors"}>
        {amount(cash?.handedOver)}
      </Stat>
      <Stat
        label="Short"
        hint={hint ?? "cash Rasi recorded and nobody counted"}
        tone="critical"
      >
        {amount(cash?.short)}
      </Stat>
      <Stat
        label="Over"
        hint={hint ?? (cash ? `${signedCurrency(cash.net)} net` : "")}
      >
        {amount(cash?.over)}
      </Stat>
    </StatGrid>
  );
}

/**
 * The API decides the order and the page, so nothing here sorts: sorting only
 * the rows loaded so far would silently be a different report.
 */
function columnsFor(manages: boolean): DataViewColumn<Row>[] {
  const columns: DataViewColumn<Row>[] = [
    identityColumn<Row>({
      header: "Junior",
      name: (row) => row.collectedByName,
      code: (row) => formatBusinessDate(row.businessDate),
      // The day close is where the handover's denomination count lives (M08).
      href: (row) => `/lines/${row.lineId}/day-closes/${row.businessDate}`,
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
    moneyColumn<Row>({
      id: "collected",
      header: "Collected",
      amount: (row) => row.collected,
    }),
    moneyColumn<Row>({
      id: "handedOver",
      header: "Handed over",
      amount: (row) => row.cash?.handedOver ?? "0.00",
      render: (row) =>
        row.cash === null ? (
          <Unknown />
        ) : (
          <span data-numeric>{formatCurrency(row.cash.handedOver)}</span>
        ),
    }),
    moneyColumn<Row>({
      id: "acknowledged",
      header: "Acknowledged",
      amount: (row) => row.cash?.acknowledged ?? "0.00",
      render: (row) =>
        row.cash === null ? (
          <Unknown />
        ) : (
          <span data-numeric>{formatCurrency(row.cash.acknowledged)}</span>
        ),
    }),
    moneyColumn<Row>({
      id: "difference",
      header: "Difference",
      amount: (row) => row.cash?.difference ?? "0.00",
      render: (row) =>
        row.cash === null ? (
          <Unknown />
        ) : (
          <Discrepancy amount={row.cash.difference} />
        ),
      card: "headline",
    }),
    displayColumn<Row>({
      id: "state",
      header: "Cash",
      align: "end",
      card: "status",
      cell: (row) =>
        row.cash === null ? (
          <Unknown />
        ) : (
          <StatusBadge
            kind="cash"
            value={row.cash.state}
            suffix={
              row.cash.handovers.length > 0
                ? `${row.cash.handovers.length}`
                : undefined
            }
          />
        ),
    }),
    displayColumn<Row>({
      id: "day",
      header: "Day",
      align: "end",
      hideOnCard: true,
      cell: (row) =>
        row.dayCloseStatus === null ? (
          <Unknown />
        ) : (
          <StatusBadge kind="day" value={row.dayCloseStatus} />
        ),
    }),
  );
  return columns.map((column) => ({ ...column, enableSorting: false }));
}
