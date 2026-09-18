"use client";

import {
  type InvestmentReport as Report,
  type InvestmentRow as Row,
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
 * Investment overview (US-085, PDF §22): per line and overall, the account
 * amount, invested amount and profit **as contracted at disbursement**, beside
 * what the ledger actually holds — money still out, money returned, and the
 * profit earned on it (BR-18, recognised on money received) — and what the
 * chosen period itself deployed and recognised.
 *
 * A Senior gets their own line and no sector or line filter (M02). A group the
 * API could not compute is left out and said so, never shown as zeros (S-07).
 */
export function InvestmentReport({
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

  const report = useApiQuery(
    reportContract.getInvestment,
    allowed && validRange
      ? {
          query: {
            from,
            to,
            ...(sectorId ? { sectorId } : {}),
            ...(lineId ? { lineId } : {}),
          },
        }
      : null,
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
            { label: "Investment" },
          ]}
        />
      }
      title="Investment overview"
      description={
        manages
          ? "What every line was lent, and what has come back. Account amount, invested and profit are the terms each account was disbursed on; outstanding, returned and profit earned are what the ledger holds now. The two dated columns are the capital deployed and the profit recognised between the dates."
          : "What your line was lent, and what has come back."
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
              description="An Admin assigns Seniors to lines. Once you are assigned, your line’s investment appears here."
            />
          )
        }
      />
    );
  } else {
    body = (
      <ReportFallback
        report={report}
        columns={7}
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
    totals.position ? null : "the standing investment",
    totals.range ? null : "this period’s postings",
  ].filter((group): group is string => group !== null);

  return (
    <>
      <PeriodTotals totals={totals} />
      {missing.length > 0 ? (
        <FormMessage tone="critical">
          {`Couldn’t work out ${missing.join(" or ")} just now, so ${
            missing.length === 1 ? "those columns are" : "they are"
          } left out.`}
        </FormMessage>
      ) : null}
      <DataView
        caption="Investment by line"
        rows={rows}
        getRowId={(row) => row.lineId}
        complete
        columns={columnsFor(totals, manages)}
        footer={<TotalsLine totals={totals} />}
      />
    </>
  );
}

/** What the chosen period itself did, all lines together. */
function PeriodTotals({ totals }: { totals: NonNullable<Report["totals"]> }) {
  const range = totals.range;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = range ? undefined : UNAVAILABLE;
  return (
    <StatGrid columns={4} aria-label="This period">
      <Stat label="Invested" hint={hint ?? "capital deployed in the period"}>
        {amount(range?.invested)}
      </Stat>
      <Stat label="Returned" hint={hint ?? "collections and corrections"}>
        {amount(range?.returned)}
      </Stat>
      <Stat
        label="Profit earned"
        hint={hint ?? "recognised on the money received (BR-18)"}
        tone={
          range && !isZeroMoney(range.profitEarned) ? "positive" : "neutral"
        }
      >
        {amount(range?.profitEarned)}
      </Stat>
      <Stat label="Accounts disbursed" hint={hint}>
        {range ? <span data-numeric>{range.disbursements}</span> : <Unknown />}
      </Stat>
    </StatGrid>
  );
}

function count(value: number): ReactNode {
  return <span data-numeric>{value}</span>;
}

/** §22's columns: contracted, then the actual position, then the period's own. */
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
  if (totals.position) {
    columns.push(
      valueColumn<Row>({
        id: "accounts",
        header: "Accounts",
        align: "end",
        value: (row) => row.position!.accounts,
        cell: (row) => count(row.position!.accounts),
      }),
      moneyColumn<Row>({
        id: "accountAmount",
        header: "Account amount",
        amount: (row) => row.position!.accountAmount,
      }),
      moneyColumn<Row>({
        id: "invested",
        header: "Invested",
        amount: (row) => row.position!.invested,
      }),
      moneyColumn<Row>({
        id: "profit",
        header: "Profit",
        amount: (row) => row.position!.profit,
      }),
      moneyColumn<Row>({
        id: "outstanding",
        header: "Still out",
        amount: (row) => row.position!.outstanding,
      }),
      moneyColumn<Row>({
        id: "returned",
        header: "Returned",
        amount: (row) => row.position!.returned,
      }),
      moneyColumn<Row>({
        id: "profitEarned",
        header: "Profit earned",
        amount: (row) => row.position!.profitEarned,
      }),
      moneyColumn<Row>({
        id: "profitToEarn",
        header: "Profit to earn",
        amount: (row) => row.position!.profitToEarn,
      }),
    );
  }
  if (totals.range) {
    columns.push(
      moneyColumn<Row>({
        id: "rangeInvested",
        header: "Invested in period",
        amount: (row) => row.range!.invested,
      }),
      moneyColumn<Row>({
        id: "rangeProfitEarned",
        header: "Earned in period",
        amount: (row) => row.range!.profitEarned,
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

/** The rows summed by the API, exactly — §22's "overall". */
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
      {item(
        "Accounts",
        totals.position ? totals.position.accounts : <Unknown />,
      )}
      {item("Account amount", amount(totals.position?.accountAmount))}
      {item("Invested", amount(totals.position?.invested))}
      {item("Still out", amount(totals.position?.outstanding))}
      {item("Returned", amount(totals.position?.returned))}
      {item("Profit earned", amount(totals.position?.profitEarned))}
      {item("Profit to earn", amount(totals.position?.profitToEarn))}
    </dl>
  );
}
