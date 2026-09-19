"use client";

import {
  AddressBook,
  ArrowRight,
  Bank,
  CheckCircle,
  Coins,
  HandCoins,
  HourglassMedium,
  MapTrifold,
  Path,
  SealCheck,
  Target,
  TrendUp,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  type BusinessOverview as Overview,
  dashboardContract,
  exportContract,
  type SectorOverview,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  arrowLinkClass,
  buttonClass,
  CodeChip,
  DetailSkeleton,
  EmptyFrame,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  HealthCard,
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

import { ExportMenu } from "../../../components/export-menu";
import { LoadFailed } from "../../../components/query-state";
import { STATUS, StatusBadge } from "../../../components/status-badge";
import { formatPerMille, isZeroMoney, perMille } from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";
import { useListState } from "../../../lib/use-list-state";
import {
  CompareSectorsLink,
  countShare,
  LiveStamp,
  Meter,
  ShareRing,
  UNAVAILABLE,
  Unknown,
  WEEKDAYS,
} from "./dashboard-parts";
import { collectedDelta, TrendCard, useTrend } from "./trend-card";

/** An empty date is today; it is left out of the URL. */
const DEFAULTS = { date: "" };

const SECTORS_ANCHOR = "sectors-today";

/**
 * S-07 · Business overview (US-080, PDF §17, §19): "how did we do today",
 * before any interaction. §17's thirteen figures, ranked rather than dropped —
 * today's four money figures first, the trend and the tally beside it, each
 * sector's day, then the structural counts and the cumulative totals. Every
 * figure the API could not compute shows "—", never a zero.
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
  const trend = useTrend(future ? null : shown);

  const header = (view: Overview | null) => (
    <PageHeader
      frame="hero"
      title="Business overview"
      meta={
        <>
          <span>
            {WEEKDAYS[dayOfWeek(parseCalendarDate(shown))]} ·{" "}
            {formatBusinessDate(shown)}
          </span>
          {view && view.day.kind !== "WORKING" ? (
            <StatusBadge kind="dayKind" value={view.day.kind} />
          ) : null}
          {view ? <LiveStamp at={view.generatedAt} /> : null}
        </>
      }
      summary={
        view ? (
          <>
            <ShareRing
              share={
                view.today
                  ? perMille(view.today.collected, view.today.expected)
                  : null
              }
              label="Collected of expected"
              caption="Collected"
            />
            <ShareRing
              share={
                view.tally
                  ? countShare(view.tally.tallied, view.tally.collecting)
                  : null
              }
              label="Sectors tallied"
              caption="Sectors tallied"
              tone="positive"
            />
          </>
        ) : null
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
            route={exportContract.overviewDashboard}
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
          {header(null)}
          <LoadFailed message={query.message} onRetry={query.reload} />
        </>
      );
  }

  const view = query.data;
  if (view.setupNeeded === true) {
    return (
      <>
        {header(view)}
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
      {header(view)}
      {view.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {view.day.kind === "SUNDAY"
            ? "Sunday: no collections are due."
            : `Holiday: ${view.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}
      <TodayFigures view={view} delta={collectedDelta(trend, shown)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendCard trend={trend} scope="every line" />
        <EntryFigures view={view} />
      </div>
      <SectorsToday view={view} />
      <StructureFigures view={view} />
      <CumulativeFigures view={view} />
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

function TodayFigures({ view, delta }: { view: Overview; delta: ReactNode }) {
  const today = view.today;
  const share = today ? perMille(today.collected, today.expected) : null;
  return (
    <StatGrid columns={4} frame="tiles" aria-label="Today’s collections">
      <Stat
        label="Expected"
        icon={<Target />}
        hint={today ? "due across every line" : UNAVAILABLE}
      >
        {money(today?.expected)}
      </Stat>
      <Stat
        label="Collected"
        icon={<HandCoins />}
        iconTone="positive"
        delta={today ? delta : null}
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
        icon={<HourglassMedium />}
        iconTone="warning"
        tone={today && !isZeroMoney(today.pending) ? "warning" : "neutral"}
        hint={today ? "short of expected, line by line" : UNAVAILABLE}
      >
        {money(today?.pending)}
      </Stat>
      <Stat
        label="Extra"
        icon={<TrendUp />}
        iconTone="info"
        hint={today ? "over expected, line by line" : UNAVAILABLE}
      >
        {money(today?.extra)}
      </Stat>
    </StatGrid>
  );
}

/** Beside the trend: the day's entries and the sectors' tally (§19). */
function EntryFigures({ view }: { view: Overview }) {
  const { today, tally } = view;
  return (
    <StatGrid
      columns={2}
      frame="tiles"
      className="content-start lg:grid-cols-1"
      aria-label="Today’s entries and tally"
    >
      <Stat
        label="Low collections"
        icon={<WarningCircle />}
        iconTone="warning"
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
        icon={<CheckCircle />}
        iconTone="positive"
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
      <StatGrid columns={4} frame="tiles">
        <Stat
          label="Sectors"
          icon={<MapTrifold />}
          iconTone="neutral"
          hint={structure ? "active" : UNAVAILABLE}
        >
          {count(structure?.sectors, "/sectors")}
        </Stat>
        <Stat
          label="Lines"
          icon={<Path />}
          iconTone="neutral"
          hint={structure ? "active" : UNAVAILABLE}
        >
          {count(structure?.lines, "/lines")}
        </Stat>
        <Stat
          label="Customers"
          icon={<AddressBook />}
          iconTone="neutral"
          hint={structure ? "on the books" : UNAVAILABLE}
        >
          {count(structure?.customers, "/customers")}
        </Stat>
        <Stat
          label="Active accounts"
          icon={<Wallet />}
          iconTone="neutral"
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
      <StatGrid columns={4} frame="tiles">
        <Stat
          label="Account amount"
          icon={<Coins />}
          iconTone="neutral"
          hint={hint}
        >
          {amount(totals?.accountAmount)}
        </Stat>
        <Stat label="Invested" icon={<Bank />} iconTone="neutral" hint={hint}>
          {amount(totals?.invested)}
        </Stat>
        <Stat label="Profit" icon={<TrendUp />} iconTone="neutral" hint={hint}>
          {amount(totals?.profit)}
        </Stat>
        <Stat
          label="Completed accounts"
          icon={<SealCheck />}
          iconTone="neutral"
          hint={accounts ? "fully collected" : UNAVAILABLE}
        >
          {accounts ? accounts.completed : <Unknown />}
        </Stat>
      </StatGrid>
    </Section>
  );
}

const TALLY_METER = {
  TALLIED: "positive",
  CLOSED: "warning",
  OPEN: "accent",
  NO_COLLECTIONS: "accent",
} as const;

function SectorsToday({ view }: { view: Overview }) {
  const sectors = view.sectors;
  return (
    <Section
      id={SECTORS_ANCHOR}
      className="scroll-mt-20"
      title="Sectors today"
      description="Each sector’s lines added up, and whether its day has tallied. Open a sector for its lines."
      actions={
        <span className="flex flex-wrap gap-4">
          <CompareSectorsLink date={view.businessDate} />
          <Link
            href={collectionsHref(view.businessDate)}
            className={arrowLinkClass}
          >
            Collections this day
            <ArrowRight aria-hidden size={14} />
          </Link>
          <Link href="/lines" className={arrowLinkClass}>
            All lines
            <ArrowRight aria-hidden size={14} />
          </Link>
        </span>
      }
    >
      {sectors === null ? (
        <FormMessage tone="critical">
          The sectors couldn’t be worked out just now, so their figures are not
          shown.
        </FormMessage>
      ) : sectors.length === 0 ? (
        <p className="text-body text-ink-muted">No sector has lines yet.</p>
      ) : (
        <ul
          aria-label="Sectors today"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {sectors.map((sector) => (
            <li key={sector.sectorId}>
              <SectorCard sector={sector} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SectorCard({ sector }: { sector: SectorOverview }) {
  const share = perMille(sector.collected, sector.expected);
  const tone = STATUS.sectorTally[sector.tally].tone;
  return (
    <HealthCard.Root className="h-full">
      <HealthCard.Header
        icon={<MapTrifold />}
        tone={
          tone === "positive"
            ? "positive"
            : tone === "warning"
              ? "warning"
              : "accent"
        }
        title={
          <Link
            href={`/sectors/${sector.sectorId}`}
            className="underline-offset-4 hover:text-accent hover:underline"
          >
            {sector.name}
          </Link>
        }
        subtitle={
          <span className="flex items-center gap-2">
            <CodeChip>{sector.code}</CodeChip>
            <span data-numeric>
              {sector.lineCount} {sector.lineCount === 1 ? "line" : "lines"}
            </span>
          </span>
        }
        value={
          <StatusBadge kind="sectorTally" value={sector.tally} shape="pill" />
        }
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-heading text-ink" data-numeric>
            {formatCurrency(sector.collected)}
          </span>
          <span className="text-caption text-ink-muted" data-numeric>
            of {formatCurrency(sector.expected)}
          </span>
        </div>
        {share === null ? null : (
          <Meter
            share={share}
            label={`${sector.name} collected of expected`}
            tone={TALLY_METER[sector.tally]}
          />
        )}
      </div>
      <HealthCard.Detail>
        {isZeroMoney(sector.shortfall) ? null : (
          <span className="font-medium text-critical">
            {formatCurrency(sector.shortfall)} short
          </span>
        )}
        {isZeroMoney(sector.shortfall) || isZeroMoney(sector.surplus)
          ? null
          : " · "}
        {isZeroMoney(sector.surplus)
          ? null
          : `${formatCurrency(sector.surplus)} extra`}
        {isZeroMoney(sector.shortfall) && isZeroMoney(sector.surplus)
          ? "On expected"
          : null}
        {sector.linesToClose > 0
          ? ` · ${sector.linesTallied} of ${sector.linesToClose} lines tallied`
          : null}
      </HealthCard.Detail>
    </HealthCard.Root>
  );
}
