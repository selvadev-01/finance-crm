"use client";

import {
  type CollectionListItem,
  type CollectionReport as Report,
  exportContract,
  type CollectionReportRow as Row,
  reportContract,
  staffContract,
} from "@repo/contracts";
import {
  DataView,
  type DataViewColumn,
  EmptyFrame,
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
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ExportMenu } from "../../../../components/export-menu";
import { PageTrail } from "../../../../components/page-trail";
import { signedCurrency } from "../../../../components/money";
import { ActivityBadge, STATUS } from "../../../../components/status-badge";
import { formatTimestamp } from "../../../../lib/format";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { isNegativeMoney, isZeroMoney } from "../../../../lib/money";
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

/** The four shared filters, plus the two only this report takes. */
export const COLLECTION_FILTERS = {
  ...REPORT_FILTERS,
  junior: "",
  classification: "",
};

type Classification = CollectionListItem["classification"];
const CLASSES: Classification[] = ["CORRECT", "LOW", "EXTRA", "NO_PAYMENT"];
const label = (kind: Classification) => STATUS.classification[kind].label;

/**
 * Collection report (US-086): over a date range, what each line was expected
 * to collect against what it actually collected, and BR-08's classification of
 * every entry behind that number — correct, low, extra, nothing paid, and the
 * visits that never happened (BR-09).
 *
 * The collector and classification filters narrow the entries only: a schedule
 * slot belongs to a line and a day, not to a Junior or a class, so expected
 * and the visits missed stay the line's own.
 *
 * A Senior gets their own line and no sector or line filter (M02). A group the
 * API could not compute is left out and said so, never shown as zeros (S-07).
 */
export function CollectionReport({
  initial,
}: {
  initial: Partial<typeof COLLECTION_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = seesReports(me.role);
  const manages = canManageOrganisation(me.role);
  const { filters, setFilter, setFilters } = useListState(
    COLLECTION_FILTERS,
    initial,
  );
  const criteria = reportCriteria(filters, manages);
  const { from, to, sectorId, lineId, filtered, validRange } = criteria;
  const junior = filters.junior;
  const classification = filters.classification as Classification | "";
  const narrowed = junior !== "" || classification !== "";

  const query = {
    from,
    to,
    ...(sectorId ? { sectorId } : {}),
    ...(lineId ? { lineId } : {}),
    ...(junior ? { collectedByUserId: junior } : {}),
    ...(classification ? { classification } : {}),
  };
  const report = useApiQuery(
    reportContract.getCollection,
    allowed && validRange ? { query } : null,
  );

  if (!allowed) return <ReportNotPermitted />;

  const clearFilters = () =>
    setFilters({ sector: "", line: "", junior: "", classification: "" });
  const thisMonth = () => setFilters({ from: "", to: "" });

  const header = (
    <PageHeader
      trail={
        <PageTrail
          steps={[
            { label: "Reports", href: "/reports" },
            { label: "Collection" },
          ]}
        />
      }
      title="Collection report"
      actions={
        <ExportMenu
          route={exportContract.collectionReport}
          query={query}
          disabled={!validRange}
        />
      }
      description={
        manages
          ? "What was collected against what was expected, and how every entry classified (BR-08). Narrow to one Junior or one class to investigate a pattern; expected and the visits missed stay the line’s own."
          : "What your line collected against what was expected, and how every entry classified."
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
        narrowed={narrowed}
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
              description="An Admin assigns Seniors to lines. Once you are assigned, your line’s collections appear here."
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
        extra={
          <>
            <CollectorFilter
              value={junior}
              onChange={(value) => setFilter("junior", value)}
            />
            <FilterField label="Class" width="sm">
              <Select
                value={classification}
                onChange={(event) =>
                  setFilter("classification", event.target.value)
                }
              >
                <option value="">Every entry</option>
                {CLASSES.map((kind) => (
                  <option key={kind} value={kind}>
                    {label(kind)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </>
        }
      />
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

function ReportBody({
  report,
  manages,
  narrowed,
  empty,
}: {
  report: Report;
  manages: boolean;
  narrowed: boolean;
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
    totals.collections ? null : "what was expected and collected",
    totals.classification ? null : "how the entries classified",
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
      {narrowed && totals.classification ? (
        <FormMessage tone="info">
          Counted entries are narrowed by the filters; expected, collected and
          missed visits are the whole line’s, because a scheduled visit belongs
          to a line and a day, not to a Junior or a class.
        </FormMessage>
      ) : null}
      <DataView
        caption="Collections by line"
        rows={rows}
        getRowId={(row) => row.lineId}
        complete
        columns={columnsFor(totals, manages)}
        footer={<TotalsLine totals={totals} />}
      />
    </>
  );
}

/** BR-16's four figures for the whole period, all lines together. */
function PeriodTotals({ totals }: { totals: NonNullable<Report["totals"]> }) {
  const money = totals.collections;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = money ? undefined : UNAVAILABLE;
  return (
    <StatGrid columns={4} aria-label="This period">
      <Stat label="Expected" hint={hint ?? "the slots due in the range"}>
        {amount(money?.expected)}
      </Stat>
      <Stat
        label="Collected"
        hint={
          hint ??
          (money ? `${signedCurrency(money.variance)} against expected` : "")
        }
        tone={money && isNegativeMoney(money.variance) ? "critical" : "neutral"}
      >
        {amount(money?.collected)}
      </Stat>
      <Stat label="Pending" hint={hint ?? "each day’s shortfall (BR-16)"}>
        {amount(money?.pending)}
      </Stat>
      <Stat label="Extra" hint={hint ?? "each day’s surplus (BR-16)"}>
        {amount(money?.extra)}
      </Stat>
    </StatGrid>
  );
}

function count(value: number): ReactNode {
  return <span data-numeric>{value}</span>;
}

/** Expected against collected, then BR-08's classes as counts. */
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
        id: "variance",
        header: "Variance",
        amount: (row) => row.collections!.variance,
        render: (row) => (
          <span
            data-numeric
            className={
              isNegativeMoney(row.collections!.variance)
                ? "text-critical"
                : isZeroMoney(row.collections!.variance)
                  ? "text-ink-muted"
                  : "text-ink"
            }
          >
            {signedCurrency(row.collections!.variance)}
          </span>
        ),
      }),
    );
  }
  if (totals.classification) {
    columns.push(
      valueColumn<Row>({
        id: "correct",
        header: label("CORRECT"),
        align: "end",
        value: (row) => row.classification!.correct.count,
        cell: (row) => count(row.classification!.correct.count),
      }),
      valueColumn<Row>({
        id: "low",
        header: label("LOW"),
        align: "end",
        value: (row) => row.classification!.low.count,
        cell: (row) => count(row.classification!.low.count),
      }),
      valueColumn<Row>({
        id: "extraEntries",
        header: label("EXTRA"),
        align: "end",
        value: (row) => row.classification!.extra.count,
        cell: (row) => count(row.classification!.extra.count),
      }),
      valueColumn<Row>({
        id: "noPayment",
        header: label("NO_PAYMENT"),
        align: "end",
        value: (row) => row.classification!.noPayment.count,
        cell: (row) => count(row.classification!.noPayment.count),
      }),
    );
  }
  if (totals.collections) {
    columns.push(
      valueColumn<Row>({
        id: "missed",
        header: "Missed",
        align: "end",
        value: (row) => row.collections!.missed,
        cell: (row) => count(row.collections!.missed),
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

/** The rows summed by the API, exactly. */
function TotalsLine({ totals }: { totals: NonNullable<Report["totals"]> }) {
  const money = totals.collections;
  const entries = totals.classification;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const item = (key: string, value: ReactNode) => (
    <div key={key} className="flex gap-1.5">
      <dt>{key}</dt>
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
      {item("Expected", amount(money?.expected))}
      {item("Collected", amount(money?.collected))}
      {item("Variance", money ? signedCurrency(money.variance) : <Unknown />)}
      {item("Pending", amount(money?.pending))}
      {item("Extra", amount(money?.extra))}
      {item("Entries", entries ? entries.recorded : <Unknown />)}
      {item("Missed", money ? money.missed : <Unknown />)}
      {entries && entries.adjusted.count > 0
        ? item(
            "Corrections",
            `${entries.adjusted.count} · ${signedCurrency(entries.adjusted.amount)}`,
          )
        : null}
    </dl>
  );
}
