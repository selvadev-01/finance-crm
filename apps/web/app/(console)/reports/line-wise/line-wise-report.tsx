"use client";

import {
  exportContract,
  type LineWiseReport as Report,
  type LineWiseRow as Row,
  reportContract,
} from "@repo/contracts";
import {
  DataView,
  type DataViewColumn,
  EmptyFrame,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  NothingYet,
  PageHeader,
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
import { Money } from "../../../../components/money";
import { PageTrail } from "../../../../components/page-trail";
import { ActivityBadge } from "../../../../components/status-badge";
import { formatTimestamp } from "../../../../lib/format";
import { isZeroMoney } from "../../../../lib/money";
import { canManageOrganisation, seesReports } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
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

/**
 * Line-wise report (US-084, PDF §14): every line's staff, customers and
 * accounts, account amount, invested and profit, and the range's expected,
 * collected, pending and extra, with the lines totalled. A Senior gets their
 * own line and no sector or line filter (M02). A group the API could not
 * compute is left out and said so, never shown as zeros (S-07).
 */
export function LineWiseReport({
  initial,
}: {
  initial: Partial<typeof REPORT_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = seesReports(me.role);
  const manages = canManageOrganisation(me.role);
  const { filters, setFilter, setFilters } = useListState(
    REPORT_FILTERS,
    initial,
  );
  const criteria = reportCriteria(filters, manages);
  const { from, to, sectorId, lineId, filtered, validRange } = criteria;

  const query = {
    from,
    to,
    ...(sectorId ? { sectorId } : {}),
    ...(lineId ? { lineId } : {}),
  };
  const report = useApiQuery(
    reportContract.getLineWise,
    allowed && validRange ? { query } : null,
  );
  if (!allowed) return <ReportNotPermitted />;

  const clearFilters = () => setFilters({ sector: "", line: "" });
  const thisMonth = () => setFilters({ from: "", to: "" });

  const header = (
    <PageHeader
      trail={
        <PageTrail
          steps={[
            { label: "Reports", href: "/reports" },
            { label: "Line-wise" },
          ]}
        />
      }
      title="Line-wise report"
      actions={
        <ExportMenu
          route={exportContract.lineWiseReport}
          query={query}
          disabled={!validRange}
        />
      }
      description={
        manages
          ? "Each line’s people, book and collections. Customers and amounts follow each customer’s current line; collections stay with the line they were recorded on."
          : "Your line’s people, book and collections."
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
  );

  let body: ReactNode;
  if (!validRange) {
    body = <ChooseRange onThisMonth={thisMonth} />;
  } else if (report.status === "ready") {
    body = (
      <ReportBody
        report={report.data}
        manages={manages}
        empty={
          filtered ? (
            <NoLinesMatch onClearFilters={clearFilters} />
          ) : manages ? (
            <NothingYet
              title="No lines yet"
              description="Lines appear here once a sector and its lines are set up."
            />
          ) : (
            <NothingYet
              title="No line assigned to you today"
              description="An Admin assigns Seniors to lines. Once you are assigned, your line’s figures appear here."
            />
          )
        }
      />
    );
  } else {
    body = (
      <ReportFallback
        report={report}
        columns={8}
        onClearFilters={clearFilters}
      />
    );
  }

  return (
    <>
      {header}
      <ReportFilterBar
        criteria={criteria}
        manages={manages}
        setFilter={setFilter}
      />
      {body}
    </>
  );
}

function ReportBody({
  report,
  manages,
  empty,
}: {
  report: Report;
  manages: boolean;
  empty: ReactNode;
}) {
  const rows = report.lines;
  if (rows === null) {
    return (
      <FormMessage tone="critical">
        The lines couldn’t be read just now, so there is no report. Try again in
        a moment.
      </FormMessage>
    );
  }
  if (rows.length === 0) return <EmptyFrame>{empty}</EmptyFrame>;

  const totals = report.totals!;
  const missing = [
    totals.book ? null : "customers and accounts",
    totals.amounts ? null : "account amounts",
    totals.collections ? null : "collections",
  ].filter((group): group is string => group !== null);

  return (
    <>
      <RangeTotals totals={totals} />
      {missing.length > 0 ? (
        <FormMessage tone="critical">
          {`Couldn’t work out ${missing.join(", ")} just now, so ${
            missing.length === 1 ? "that column is" : "those columns are"
          } left out.`}
        </FormMessage>
      ) : null}
      <DataView
        caption="Lines"
        rows={rows}
        getRowId={(row) => row.lineId}
        complete
        columns={columnsFor(totals, manages)}
        footer={<TotalsLine totals={totals} />}
      />
    </>
  );
}

/** The range's money, all lines together. */
function RangeTotals({ totals }: { totals: NonNullable<Report["totals"]> }) {
  const money = totals.collections;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = money ? undefined : UNAVAILABLE;
  return (
    <StatGrid columns={4} aria-label="Collections in the range">
      <Stat label="Expected" hint={hint}>
        {amount(money?.expected)}
      </Stat>
      <Stat label="Collected" hint={hint}>
        {amount(money?.collected)}
      </Stat>
      <Stat
        label="Pending"
        hint={hint ?? "short on the days it fell due"}
        tone={money && !isZeroMoney(money.pending) ? "warning" : "neutral"}
      >
        {amount(money?.pending)}
      </Stat>
      <Stat
        label="Extra"
        hint={hint ?? "over on the days it was paid"}
        tone={money && !isZeroMoney(money.extra) ? "positive" : "neutral"}
      >
        {amount(money?.extra)}
      </Stat>
    </StatGrid>
  );
}

function count(value: number): ReactNode {
  return <span data-numeric>{value}</span>;
}

/** §14's columns; a group unknown for every row is left out. */
function columnsFor(
  totals: NonNullable<Report["totals"]>,
  manages: boolean,
): DataViewColumn<Row>[] {
  const columns: DataViewColumn<Row>[] = [
    identityColumn<Row>({
      header: "Line",
      name: (row) => row.name,
      code: (row) =>
        row.isActive ? (
          row.code
        ) : (
          <span className="inline-flex items-center gap-2">
            {row.code}
            <ActivityBadge isActive={false} />
          </span>
        ),
      href: (row) => `/lines/${row.lineId}`,
    }),
  ];
  if (manages) {
    columns.push(
      valueColumn<Row>({
        id: "sector",
        header: "Sector",
        value: (row) => row.sectorName,
      }),
    );
  }
  columns.push(
    valueColumn<Row>({
      id: "senior",
      header: "Senior",
      value: (row) => row.staff.seniorName ?? "",
      cell: (row) =>
        row.staff.seniorName ?? <span className="text-ink-subtle">None</span>,
    }),
    valueColumn<Row>({
      id: "juniors",
      header: "Juniors",
      value: (row) => row.staff.juniorNames.join(", "),
      cell: (row) =>
        row.staff.juniorNames.length > 0 ? (
          row.staff.juniorNames.join(", ")
        ) : (
          <span className="text-ink-subtle">None</span>
        ),
    }),
  );
  if (totals.book) {
    columns.push(
      valueColumn<Row>({
        id: "customers",
        header: "Customers",
        align: "end",
        value: (row) => row.book!.customers,
        cell: (row) => count(row.book!.customers),
      }),
      valueColumn<Row>({
        id: "accounts",
        header: "Accounts",
        align: "end",
        value: (row) => row.book!.accounts,
        cell: (row) => count(row.book!.accounts),
      }),
      valueColumn<Row>({
        id: "completed",
        header: "Completed",
        align: "end",
        value: (row) => row.book!.completedAccounts,
        cell: (row) => count(row.book!.completedAccounts),
      }),
    );
  }
  if (totals.amounts) {
    columns.push(
      moneyColumn<Row>({
        id: "accountAmount",
        header: "Account amount",
        amount: (row) => row.amounts!.accountAmount,
      }),
      moneyColumn<Row>({
        id: "invested",
        header: "Invested",
        amount: (row) => row.amounts!.invested,
      }),
      moneyColumn<Row>({
        id: "profit",
        header: "Profit",
        amount: (row) => row.amounts!.profit,
      }),
    );
  }
  if (totals.collections) {
    columns.push(
      moneyColumn<Row>({
        id: "expected",
        header: "Expected",
        amount: (row) => row.collections!.expected,
      }),
      moneyColumn<Row>({
        id: "collected",
        header: "Collected",
        amount: (row) => row.collections!.collected,
        card: "headline",
      }),
      moneyColumn<Row>({
        id: "pending",
        header: "Pending",
        amount: (row) => row.collections!.pending,
        render: (row) => (
          <Money
            amount={row.collections!.pending}
            className={
              isZeroMoney(row.collections!.pending)
                ? undefined
                : "font-medium text-critical"
            }
          />
        ),
      }),
      moneyColumn<Row>({
        id: "extra",
        header: "Extra",
        amount: (row) => row.collections!.extra,
      }),
    );
  }
  if (!manages) {
    // Nothing to compare a Senior's single line with: no sort affordance needed.
    return columns.map((column) =>
      column.id === "identity" ? column : { ...column, enableSorting: false },
    );
  }
  return columns;
}

/** The rows summed by the API, exactly (§23). */
function TotalsLine({ totals }: { totals: NonNullable<Report["totals"]> }) {
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const item = (label: string, value: ReactNode) => (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd data-numeric className="text-ink">
        {value}
      </dd>
    </div>
  );
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-muted">
      {item(
        "Totals",
        `${totals.lines} ${totals.lines === 1 ? "line" : "lines"}`,
      )}
      {item("Customers", totals.book ? totals.book.customers : <Unknown />)}
      {item(
        "Accounts",
        totals.book ? (
          `${totals.book.accounts} (${totals.book.completedAccounts} completed)`
        ) : (
          <Unknown />
        ),
      )}
      {item("Account amount", amount(totals.amounts?.accountAmount))}
      {item("Invested", amount(totals.amounts?.invested))}
      {item("Profit", amount(totals.amounts?.profit))}
    </dl>
  );
}
