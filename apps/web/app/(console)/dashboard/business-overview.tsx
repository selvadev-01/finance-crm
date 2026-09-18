"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import {
  type BusinessOverview as Overview,
  dashboardContract,
  type SectorOverview,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  buttonClass,
  DataView,
  DetailSkeleton,
  EmptyFrame,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  Input,
  NothingYet,
  NotPermitted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../components/columns";
import { Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import { formatTimestamp } from "../../../lib/format";
import { formatPerMille, isZeroMoney, perMille } from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";
import { useListState } from "../../../lib/use-list-state";
import {
  CompareSectorsLink,
  Meter,
  UNAVAILABLE,
  Unknown,
  WEEKDAYS,
} from "./dashboard-parts";

/** An empty date is today; it is left out of the URL. */
const DEFAULTS = { date: "" };

const SECTORS_ANCHOR = "sectors-today";

/**
 * S-07 · Business overview (US-080, PDF §17, §19): "how did we do today",
 * before any interaction. §17's thirteen figures, ranked rather than dropped —
 * today's four money figures first, the structural counts second, the
 * cumulative totals third — then each sector's day. Every figure the API
 * could not compute shows "—", never a zero.
 */
export function BusinessOverview({
  initial,
}: {
  initial: Partial<typeof DEFAULTS>;
}) {
  const { filters, setFilter } = useListState(DEFAULTS, initial);
  const today = toBusinessDate(new Date());
  const shown = filters.date || today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getOverview,
    future ? null : { query: filters.date ? { date: filters.date } : {} },
  );

  const header = (updatedAt: string | null, day: Overview["day"] | null) => (
    <PageHeader
      title="Business overview"
      meta={
        <>
          <span>
            {WEEKDAYS[dayOfWeek(parseCalendarDate(shown))]} ·{" "}
            {formatBusinessDate(shown)}
          </span>
          {day && day.kind !== "WORKING" ? (
            <StatusBadge kind="dayKind" value={day.kind} />
          ) : null}
          {updatedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-pill bg-positive" />
              Live · updated {formatTimestamp(updatedAt, "clock")}
            </span>
          ) : null}
        </>
      }
      actions={
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
      }
    />
  );

  if (future) {
    return (
      <>
        {header(null, null)}
        <FormMessage tone="info">
          The overview shows today or an earlier day. Pick another date.
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
          <NotPermitted description="The business overview is for Super Admins and Admins." />
        </EmptyFrame>
      );
    case "error":
      return (
        <>
          {header(null, null)}
          <LoadFailed message={query.message} onRetry={query.reload} />
        </>
      );
  }

  const view = query.data;
  if (view.setupNeeded === true) {
    return (
      <>
        {header(view.generatedAt, view.day)}
        <EmptyFrame>
          <NothingYet
            title="Set up the business first"
            description="The overview fills in once there is a sector with a line to collect on."
            action={
              <Link href="/sectors" className={buttonClass("primary")}>
                Go to sectors
              </Link>
            }
          />
        </EmptyFrame>
      </>
    );
  }

  return (
    <>
      {header(view.generatedAt, view.day)}
      {view.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {view.day.kind === "SUNDAY"
            ? "Sunday: no collections are due."
            : `Holiday: ${view.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}
      <TodayFigures view={view} />
      <StructureFigures view={view} />
      <CumulativeFigures view={view} />
      <SectorsToday view={view} />
    </>
  );
}

/** A figure that opens the page explaining it. */
function FigureLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="decoration-1 underline-offset-4 hover:underline focus-visible:underline"
    >
      {children}
    </Link>
  );
}

function money(amount: string | undefined): ReactNode {
  return amount === undefined ? (
    <Unknown />
  ) : (
    <FigureLink href={`#${SECTORS_ANCHOR}`}>
      {formatCurrency(amount)}
    </FigureLink>
  );
}

function collectionsHref(date: string): string {
  return `/collections?from=${date}&to=${date}`;
}

function TodayFigures({ view }: { view: Overview }) {
  const today = view.today;
  const tally = view.tally;
  const share = today ? perMille(today.collected, today.expected) : null;
  return (
    <>
      <StatGrid columns={4} aria-label="Today’s collections">
        <Stat
          label="Expected"
          hint={today ? "due across every line" : UNAVAILABLE}
        >
          {money(today?.expected)}
        </Stat>
        <Stat
          label="Collected"
          hint={
            today ? (
              share === null ? (
                "nothing was due"
              ) : (
                <span className="flex items-center gap-2">
                  <Meter share={share} label="Collected of expected" />
                  <span data-numeric>{formatPerMille(share)}</span>
                </span>
              )
            ) : (
              UNAVAILABLE
            )
          }
        >
          {money(today?.collected)}
        </Stat>
        <Stat
          label="Pending"
          tone={today && !isZeroMoney(today.pending) ? "warning" : "neutral"}
          hint={today ? "short of expected, line by line" : UNAVAILABLE}
        >
          {money(today?.pending)}
        </Stat>
        <Stat
          label="Extra"
          hint={today ? "over expected, line by line" : UNAVAILABLE}
        >
          {money(today?.extra)}
        </Stat>
      </StatGrid>

      <StatGrid columns={2} aria-label="Today’s entries and tally">
        <Stat
          label="Low collections"
          hint={
            today
              ? `paid less than expected · ${today.extraCount} paid more`
              : UNAVAILABLE
          }
        >
          {today ? (
            <FigureLink href={collectionsHref(view.businessDate)}>
              {today.lowCount}
            </FigureLink>
          ) : (
            <Unknown />
          )}
        </Stat>
        <Stat
          label="Sectors tallied"
          hint={
            tally
              ? tally.collecting === 0
                ? "no sector had collections due"
                : `${tally.withExtra} with extra · ${tally.withLow} with low collection`
              : UNAVAILABLE
          }
        >
          {tally ? (
            <FigureLink href={`#${SECTORS_ANCHOR}`}>
              {tally.tallied}
              <span className="text-ink-muted"> of {tally.collecting}</span>
            </FigureLink>
          ) : (
            <Unknown />
          )}
        </Stat>
      </StatGrid>
    </>
  );
}

function StructureFigures({ view }: { view: Overview }) {
  const { structure, accounts } = view;
  const count = (value: number | undefined, href: string | null) =>
    value === undefined ? (
      <Unknown />
    ) : href ? (
      <FigureLink href={href}>{value}</FigureLink>
    ) : (
      value
    );
  return (
    <Section title="The business">
      <StatGrid columns={4}>
        <Stat label="Sectors" hint={structure ? "active" : UNAVAILABLE}>
          {count(structure?.sectors, "/sectors")}
        </Stat>
        <Stat label="Lines" hint={structure ? "active" : UNAVAILABLE}>
          {count(structure?.lines, "/lines")}
        </Stat>
        <Stat label="Customers" hint={structure ? "on the books" : UNAVAILABLE}>
          {count(structure?.customers, "/customers")}
        </Stat>
        <Stat
          label="Active accounts"
          hint={accounts ? "collecting now" : UNAVAILABLE}
        >
          {count(accounts?.active, null)}
        </Stat>
      </StatGrid>
    </Section>
  );
}

function CumulativeFigures({ view }: { view: Overview }) {
  const { totals, accounts } = view;
  const amount = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const hint = totals ? "every account disbursed" : UNAVAILABLE;
  return (
    <Section
      title="All time"
      description="Account amount, invested and profit come from the ledger."
    >
      <StatGrid columns={4}>
        <Stat label="Account amount" hint={hint}>
          {amount(totals?.accountAmount)}
        </Stat>
        <Stat label="Invested" hint={hint}>
          {amount(totals?.invested)}
        </Stat>
        <Stat label="Profit" hint={hint}>
          {amount(totals?.profit)}
        </Stat>
        <Stat
          label="Completed accounts"
          hint={accounts ? "fully collected" : UNAVAILABLE}
        >
          {accounts ? accounts.completed : <Unknown />}
        </Stat>
      </StatGrid>
    </Section>
  );
}

function SectorsToday({ view }: { view: Overview }) {
  const sectors = view.sectors;
  return (
    <Section
      id={SECTORS_ANCHOR}
      className="scroll-mt-6"
      title="Sectors today"
      description="Each sector’s lines added up, and whether its day has tallied. Open a sector for its lines."
    >
      {sectors === null ? (
        <FormMessage tone="critical">
          The sectors couldn’t be worked out just now, so their figures are not
          shown.
        </FormMessage>
      ) : (
        <DataView
          caption="Sectors today"
          rows={sectors}
          getRowId={(sector) => sector.sectorId}
          complete
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-muted">
              <span data-numeric>
                {sectors.length} {sectors.length === 1 ? "sector" : "sectors"}{" "}
                with lines
              </span>
              <span className="flex flex-wrap gap-4">
                <CompareSectorsLink date={view.businessDate} />
                <Link
                  href={collectionsHref(view.businessDate)}
                  className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
                >
                  Collections this day
                  <ArrowRight aria-hidden size={14} />
                </Link>
                <Link
                  href="/lines"
                  className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
                >
                  All lines
                  <ArrowRight aria-hidden size={14} />
                </Link>
              </span>
            </div>
          }
          columns={[
            identityColumn<SectorOverview>({
              header: "Sector",
              name: (sector) => sector.name,
              code: (sector) => sector.code,
              href: (sector) => `/sectors/${sector.sectorId}`,
            }),
            valueColumn<SectorOverview>({
              id: "lines",
              header: "Lines",
              align: "end",
              value: (sector) => sector.lineCount,
              cell: (sector) => <span data-numeric>{sector.lineCount}</span>,
            }),
            moneyColumn<SectorOverview>({
              id: "expected",
              header: "Expected",
              amount: (sector) => sector.expected,
            }),
            moneyColumn<SectorOverview>({
              id: "collected",
              header: "Collected",
              amount: (sector) => sector.collected,
            }),
            moneyColumn<SectorOverview>({
              id: "shortfall",
              header: "Shortfall",
              amount: (sector) => sector.shortfall,
              render: (sector) => (
                <Money
                  amount={sector.shortfall}
                  className={
                    isZeroMoney(sector.shortfall)
                      ? undefined
                      : "font-medium text-critical"
                  }
                />
              ),
            }),
            moneyColumn<SectorOverview>({
              id: "surplus",
              header: "Extra",
              amount: (sector) => sector.surplus,
            }),
            displayColumn<SectorOverview>({
              id: "tally",
              header: "Day",
              align: "end",
              cell: (sector) => (
                <span className="flex flex-col items-end gap-0.5">
                  <StatusBadge kind="sectorTally" value={sector.tally} />
                  {sector.linesToClose > 0 ? (
                    <span className="text-caption text-ink-muted" data-numeric>
                      {sector.linesTallied} of {sector.linesToClose} lines
                      tallied
                    </span>
                  ) : null}
                </span>
              ),
            }),
          ]}
        />
      )}
    </Section>
  );
}
