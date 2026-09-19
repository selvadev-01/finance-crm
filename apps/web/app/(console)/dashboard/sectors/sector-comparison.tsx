"use client";

import {
  dashboardContract,
  exportContract,
  type SectorComparison as Comparison,
  type SectorComparisonRow as Row,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  DataView,
  type DataViewColumn,
  DetailSkeleton,
  EmptyFrame,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  Input,
  NotPermitted,
  PageHeader,
  Section,
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
import { Money } from "../../../../components/money";
import { PageTrail } from "../../../../components/page-trail";
import { LoadFailed } from "../../../../components/query-state";
import {
  ActivityBadge,
  StatusBadge,
} from "../../../../components/status-badge";
import { formatTimestamp } from "../../../../lib/format";
import { isZeroMoney } from "../../../../lib/money";
import { seesSectorTotals } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { UNAVAILABLE, Unknown, WEEKDAYS } from "../dashboard-parts";

/** An empty date is today; it is left out of the URL. */
export const SECTOR_COMPARISON_FILTERS = { date: "" };

/**
 * Sector comparison (US-081, PDF §18, §19): every sector side by side for one
 * business date — lines, customers, account amount, invested and profit, and
 * the day's money and tally — with §19's "how many tallied, had extra, had
 * low". A group the API could not compute is left out and said so, never
 * shown as zeros (S-07).
 */
export function SectorComparison({
  initial,
}: {
  initial: Partial<typeof SECTOR_COMPARISON_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = seesSectorTotals(me.role);
  const { filters, setFilter } = useListState(
    SECTOR_COMPARISON_FILTERS,
    initial,
  );
  const today = toBusinessDate(new Date());
  const shown = filters.date || today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getSectors,
    !allowed || future
      ? null
      : { query: filters.date ? { date: filters.date } : {} },
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The sector comparison is for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  const header = (view: Comparison | null) => (
    <PageHeader
      trail={
        <PageTrail
          steps={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sector comparison" },
          ]}
        />
      }
      title="Sector comparison"
      meta={
        <>
          <span>
            {WEEKDAYS[dayOfWeek(parseCalendarDate(shown))]} ·{" "}
            {formatBusinessDate(shown)}
          </span>
          {view && view.day.kind !== "WORKING" ? (
            <StatusBadge kind="dayKind" value={view.day.kind} />
          ) : null}
          {view ? (
            <span>updated {formatTimestamp(view.generatedAt, "clock")}</span>
          ) : null}
        </>
      }
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label="Date" width="sm">
            <Input
              type="date"
              value={shown}
              max={today}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                setFilter("date", value === today ? "" : value);
              }}
            />
          </FilterField>
          <ExportMenu
            route={exportContract.sectorsDashboard}
            query={filters.date ? { date: filters.date } : {}}
            disabled={future}
          />
        </div>
      }
    />
  );

  if (future) {
    return (
      <>
        {header(null)}
        <FormMessage tone="info">
          The comparison shows today or an earlier day. Pick another date.
        </FormMessage>
      </>
    );
  }

  switch (query.status) {
    case "loading":
      return <DetailSkeleton />;
    case "not-found":
    case "not-permitted":
      return (
        <EmptyFrame>
          <NotPermitted description="The sector comparison is for Super Admins and Admins." />
        </EmptyFrame>
      );
    case "error":
      return (
        <>
          {header(null)}
          <LoadFailed message={query.message} onRetry={query.reload} />
        </>
      );
  }

  const view = query.data;
  return (
    <>
      {header(view)}
      {view.setupNeeded === true ? (
        <FormMessage tone="info">
          There is no line to collect on yet, so every sector reads zero.
        </FormMessage>
      ) : null}
      <TallySummary view={view} />
      <SectorTable view={view} />
    </>
  );
}

/** §19: "Tally Completed 8; Extra Collection 2; Low Collection 2." */
function TallySummary({ view }: { view: Comparison }) {
  const tally = view.tally;
  const of = (value: number | undefined) =>
    tally === null || value === undefined ? (
      <Unknown />
    ) : (
      <>
        {value}
        <span className="text-ink-muted"> of {tally.collecting}</span>
      </>
    );
  const hint =
    tally === null
      ? UNAVAILABLE
      : tally.collecting === 0
        ? "no sector had collections due"
        : "of the sectors collecting";
  return (
    <StatGrid columns={3} aria-label="Collection status">
      <Stat label="Tallied" hint={hint}>
        {of(tally?.tallied)}
      </Stat>
      <Stat
        label="Extra collection"
        hint={hint}
        tone={tally && tally.withExtra > 0 ? "positive" : "neutral"}
      >
        {of(tally?.withExtra)}
      </Stat>
      <Stat
        label="Low collection"
        hint={hint}
        tone={tally && tally.withLow > 0 ? "warning" : "neutral"}
      >
        {of(tally?.withLow)}
      </Stat>
    </StatGrid>
  );
}

function count(value: number): ReactNode {
  return <span data-numeric>{value}</span>;
}

function SectorTable({ view }: { view: Comparison }) {
  const rows = view.sectors;
  if (rows === null) {
    return (
      <FormMessage tone="critical">
        The sectors couldn’t be read just now, so they are not compared.
      </FormMessage>
    );
  }

  // A group is unknown for every row at once: its columns are left out.
  const knowsStructure = rows.every((row) => row.structure !== null);
  const knowsTotals = rows.every((row) => row.totals !== null);
  const knowsDay = rows.every((row) => row.today !== null);
  const missing = [
    knowsStructure ? null : "lines and customers",
    knowsTotals ? null : "account amounts",
    knowsDay ? null : "the day’s collections",
  ].filter((group): group is string => group !== null);

  const columns: DataViewColumn<Row>[] = [
    identityColumn<Row>({
      header: "Sector",
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
      href: (row) => `/sectors/${row.sectorId}`,
    }),
  ];
  if (knowsStructure) {
    columns.push(
      valueColumn<Row>({
        id: "lines",
        header: "Lines",
        align: "end",
        value: (row) => row.structure!.lines,
        cell: (row) => count(row.structure!.lines),
      }),
      valueColumn<Row>({
        id: "customers",
        header: "Customers",
        align: "end",
        value: (row) => row.structure!.customers,
        cell: (row) => count(row.structure!.customers),
      }),
    );
  }
  if (knowsTotals) {
    columns.push(
      moneyColumn<Row>({
        id: "accountAmount",
        header: "Account amount",
        amount: (row) => row.totals!.accountAmount,
      }),
      moneyColumn<Row>({
        id: "invested",
        header: "Invested",
        amount: (row) => row.totals!.invested,
      }),
      moneyColumn<Row>({
        id: "profit",
        header: "Profit",
        amount: (row) => row.totals!.profit,
      }),
    );
  }
  if (knowsDay) {
    columns.push(
      moneyColumn<Row>({
        id: "expected",
        header: "Expected",
        amount: (row) => row.today!.expected,
      }),
      moneyColumn<Row>({
        id: "collected",
        header: "Collected",
        amount: (row) => row.today!.collected,
        card: "headline",
      }),
      moneyColumn<Row>({
        id: "shortfall",
        header: "Low",
        amount: (row) => row.today!.shortfall,
        render: (row) => (
          <Money
            amount={row.today!.shortfall}
            className={
              isZeroMoney(row.today!.shortfall)
                ? undefined
                : "font-medium text-critical"
            }
          />
        ),
      }),
      moneyColumn<Row>({
        id: "surplus",
        header: "Extra",
        amount: (row) => row.today!.surplus,
      }),
      displayColumn<Row>({
        id: "tally",
        header: "Day",
        align: "end",
        card: "status",
        cell: (row) => (
          <span className="flex flex-col items-end gap-0.5">
            <StatusBadge kind="sectorTally" value={row.today!.tally} />
            {row.today!.linesToClose > 0 ? (
              <span className="text-caption text-ink-muted" data-numeric>
                {row.today!.linesTallied} of {row.today!.linesToClose} lines
                tallied
              </span>
            ) : null}
          </span>
        ),
      }),
    );
  }

  return (
    <Section
      title="Sectors side by side"
      description="Customers and amounts follow each customer’s current line; the day’s money stays with the line it was collected on. Amounts come from the ledger, for every account disbursed."
    >
      {missing.length > 0 ? (
        <FormMessage tone="critical">
          {`Couldn’t work out ${missing.join(", ")} just now, so ${
            missing.length === 1 ? "that column is" : "those columns are"
          } left out.`}
        </FormMessage>
      ) : null}
      <DataView
        caption="Sectors compared"
        rows={rows}
        getRowId={(row) => row.sectorId}
        complete
        columns={columns}
        footer={<BusinessLine view={view} />}
      />
    </Section>
  );
}

/** The business read on its own: the rows add up to these (§23). */
function BusinessLine({ view }: { view: Comparison }) {
  const { structure, totals, today } = view.business;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-muted">
      <div className="flex gap-1.5">
        <dt>Business</dt>
        <dd data-numeric className="text-ink">
          {structure ? (
            `${structure.sectors} active sectors · ${structure.lines} lines · ${structure.customers} customers`
          ) : (
            <Unknown />
          )}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>Account amount</dt>
        <dd data-numeric className="text-ink">
          {amount(totals?.accountAmount)}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>Invested</dt>
        <dd data-numeric className="text-ink">
          {amount(totals?.invested)}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>Profit</dt>
        <dd data-numeric className="text-ink">
          {amount(totals?.profit)}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>Collected</dt>
        <dd data-numeric className="text-ink">
          {today ? (
            <>
              {formatCurrency(today.collected)} of{" "}
              {formatCurrency(today.expected)}
            </>
          ) : (
            <Unknown />
          )}
        </dd>
      </div>
    </dl>
  );
}
