"use client";

import { MAX_REPORT_DAYS, organisationContract as org } from "@repo/contracts";
import {
  addCalendarDays,
  isCalendarDate,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
} from "@repo/domain";
import {
  Button,
  EmptyFrame,
  FilterBar,
  FilterField,
  Input,
  ListSkeleton,
  NoMatches,
  NotPermitted,
  Select,
} from "@repo/ui";
import type { ReactNode } from "react";

import { LineFilter } from "../../../components/line-filter";
import { LoadFailed } from "../../../components/query-state";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { useApiQuery } from "../../../lib/use-api-query";

/**
 * The parts every M12 report screen shares (US-084 set the pattern): the four
 * filters in the URL, the range rule the API enforces, and the states a report
 * shows when it has no rows to show.
 *
 * Blank `from` is the first day of `to`'s month and blank `to` is today — the
 * API's own defaults — so a link without dates follows the calendar.
 */
export const REPORT_FILTERS = { from: "", to: "", sector: "", line: "" };

/**
 * `from` on or before `to`, `to` no later than today, and at most
 * {@link MAX_REPORT_DAYS} days inclusive — the API's own rule, so the screen
 * refuses the range the API would refuse instead of asking for it.
 */
export function isValidReportRange(
  from: string,
  to: string,
  today: string,
): boolean {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return false;
  if (from > to || to > today) return false;
  return from >= addCalendarDays(parseCalendarDate(to), -(MAX_REPORT_DAYS - 1));
}

/**
 * The sector and line a report is narrowed to, resolved from the URL. Only an
 * Admin or Super Admin has more than one line to choose between, so a Senior's
 * is always their own — which the API decides, not this (M02).
 */
export function reportScope(
  filters: { sector: string; line: string },
  manages: boolean,
) {
  const sectorId = manages ? filters.sector : "";
  const lineId = manages ? filters.line : "";
  return {
    sectorId,
    lineId,
    filtered: sectorId !== "" || lineId !== "",
  };
}

/** The dates and filters a report is reading, resolved from the URL. */
export function reportCriteria(
  filters: typeof REPORT_FILTERS,
  manages: boolean,
) {
  const today = toBusinessDate(new Date());
  const to = filters.to || today;
  const from = filters.from || (isCalendarDate(to) ? startOfMonth(to) : "");
  return {
    today,
    from,
    to,
    ...reportScope(filters, manages),
    validRange: isValidReportRange(from, to, today),
  };
}

/**
 * From / To, and Sector / Line for the roles that see more than one line.
 * `extra` is where a report adds a filter only it takes — the collection
 * report's collector and classification (US-086) — so the four every report
 * shares stay in one place and in the same order on every screen.
 */
export function ReportFilterBar({
  criteria,
  manages,
  setFilter,
  extra,
}: {
  criteria: ReturnType<typeof reportCriteria>;
  manages: boolean;
  setFilter: (key: "from" | "to" | "sector" | "line", value: string) => void;
  extra?: ReactNode;
}) {
  const { from, to, today, sectorId, lineId } = criteria;
  return (
    <FilterBar>
      <FilterField label="From" width="sm">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(event) => setFilter("from", event.target.value)}
        />
      </FilterField>
      <FilterField label="To" width="sm">
        <Input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(event) =>
            setFilter(
              "to",
              event.target.value === today ? "" : event.target.value,
            )
          }
        />
      </FilterField>
      {manages ? (
        <ReportScopeFilters
          sectorId={sectorId}
          lineId={lineId}
          setFilter={setFilter}
        />
      ) : null}
      {extra}
    </FilterBar>
  );
}

/**
 * Sector and Line, the two filters every report shares — the overdue report
 * (US-087) takes them without the dates, because it is the position now.
 * Rendered only for the roles that see more than one line.
 */
export function ReportScopeFilters({
  sectorId,
  lineId,
  setFilter,
}: {
  sectorId: string;
  lineId: string;
  setFilter: (key: "sector" | "line", value: string) => void;
}) {
  const sectors = useApiQuery(org.listSectors, {
    query: { limit: LIST_LIMIT, includeInactive: "true" },
  });
  return (
    <>
      <FilterField label="Sector" width="lg">
        <Select
          value={sectorId}
          onChange={(event) => setFilter("sector", event.target.value)}
        >
          <option value="">All sectors</option>
          {sectors.status === "ready"
            ? sectors.data.data.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                  {sector.isActive ? "" : " (inactive)"}
                </option>
              ))
            : null}
        </Select>
      </FilterField>
      <LineFilter
        value={lineId}
        onChange={(value) => setFilter("line", value)}
      />
    </>
  );
}

/** A range the API would refuse: the screen says so and offers the month. */
export function ChooseRange({ onThisMonth }: { onThisMonth: () => void }) {
  return (
    <EmptyFrame>
      <NoMatches
        title="Choose a date range"
        description={`“From” must be on or before “To”, within ${MAX_REPORT_DAYS} days, and “To” no later than today.`}
        action={<Button onClick={onThisMonth}>Show this month</Button>}
      />
    </EmptyFrame>
  );
}

/** A sector or line filter that leaves no line to report on. */
export function NoLinesMatch({
  onClearFilters,
}: {
  onClearFilters: () => void;
}) {
  return (
    <NoMatches
      title="No lines match"
      description="No line in this sector, or the line is in another sector."
      action={<Button onClick={onClearFilters}>Clear filters</Button>}
    />
  );
}

/** Reports are for Super Admins, Admins and Seniors; a Junior never sees one. */
export function ReportNotPermitted() {
  return (
    <EmptyFrame>
      <NotPermitted description="Reports are for Super Admins, Admins and Seniors." />
    </EmptyFrame>
  );
}

type ReportQuery = {
  status: "loading" | "ready" | "not-found" | "not-permitted" | "error";
  message?: string;
  reload: () => void;
};

/**
 * What a report shows while it has no rows: its loading shape, a failed read,
 * a filter naming a sector or line that is gone or not the caller's (`404`,
 * M02), or a refusal. `null` once the report is ready — then the screen draws
 * its own table.
 */
export function ReportFallback({
  report,
  columns,
  onClearFilters,
}: {
  report: ReportQuery;
  /** How many columns the loading skeleton draws. */
  columns: number;
  onClearFilters: () => void;
}): ReactNode {
  switch (report.status) {
    case "loading":
      return <ListSkeleton columns={columns} />;
    case "not-found":
      return (
        <EmptyFrame>
          <NoMatches
            title="That sector or line isn’t available"
            description="It may have been removed, or it is outside what you can see."
            action={<Button onClick={onClearFilters}>Show every line</Button>}
          />
        </EmptyFrame>
      );
    case "not-permitted":
      return <ReportNotPermitted />;
    case "error":
      return (
        <LoadFailed message={report.message ?? ""} onRetry={report.reload} />
      );
    case "ready":
      return null;
  }
}
