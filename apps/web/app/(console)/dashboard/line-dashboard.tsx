"use client";

import {
  ArrowRight,
  ArrowsLeftRight,
  CloudArrowUp,
  HandCoins,
  HourglassMedium,
  LockKey,
  MapPin,
  Target,
  TrendUp,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  dashboardContract,
  type DiscrepancyRow,
  exportContract,
  type LineDashboard as Dashboard,
  reportContract,
  type TrendPoint,
  type WatchedAccount,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  arrowLinkClass,
  Badge,
  buttonClass,
  Card,
  cn,
  CodeChip,
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
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../components/columns";
import { ExportMenu } from "../../../components/export-menu";
import { Discrepancy, signedCurrency } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import { formatTimestamp } from "../../../lib/format";
import {
  absMoney,
  formatPerMille,
  isNegativeMoney,
  isZeroMoney,
  perMille,
  subtractMoney,
  sumMoney,
} from "../../../lib/money";
import { homeMenu } from "../../../lib/home-menu";
import { useApiQuery } from "../../../lib/use-api-query";
import {
  countShare,
  LiveStamp,
  UNAVAILABLE,
  Unknown,
  WEEKDAYS,
} from "./dashboard-parts";
import {
  type ActionRow,
  ActionList,
  heroBandClass,
  HeroUnknown,
  KpiCard,
  MiniRing,
  Sparkline,
} from "./dashboard-visuals";
import {
  Chip,
  DateTap,
  type HomeRow,
  ListCard,
  MenuGrid,
  rupees,
  SectionHeader,
  shortDate,
  StickyAction,
  SummaryCard,
  SummaryRing,
  usePhoneLayout,
} from "./phone-home";
import { useTrend } from "./trend-card";

type LineView = Extract<Dashboard, { state: "LINE" }>;
type Day = NonNullable<LineView["day"]>;
type Junior = Day["juniors"][number];
type Exception = Day["exceptions"][number];

const EXCEPTIONS_ANCHOR = "exceptions";

/**
 * S-19 · Senior line dashboard (US-083; Stitch "LIN-00004 · Mylapore East —
 * Senior Dashboard", 2026-10-02): the Senior's current line for one day —
 * how much came in and how much of it is in their hand, each Junior's cash
 * and phone, what waits on them before the day can close, the entries that
 * need a look, and the accounts nearly done or past their target. The day's
 * money is the day close's own (S-05); each Junior's cash is the discrepancy
 * report's row (BR-17). A figure the API could not compute shows "—" (S-07).
 */
export function LineDashboard({ date }: { date: string | undefined }) {
  const router = useRouter();
  const phone = usePhoneLayout();
  const today = toBusinessDate(new Date());
  const shown = date ?? today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getLine,
    future ? null : { query: date ? { date } : {} },
  );
  // The line's own reads, once the line is known: never a line the page isn't showing.
  const line =
    query.status === "ready" && query.data.state === "LINE"
      ? query.data.line
      : null;
  const trend = useTrend(line ? shown : null, line?.lineId);
  const cash = useApiQuery(
    reportContract.getDiscrepancy,
    line
      ? {
          query: {
            from: shown,
            to: shown,
            lineId: line.lineId,
            show: "all",
            limit: 50,
          },
        }
      : null,
  );

  const header = (view: LineView | null, generatedAt: string | null) => (
    <PageHeader
      title={
        view ? (
          <span className="flex flex-wrap items-center gap-2">
            <CodeChip>{view.line.code}</CodeChip>
            {view.line.name}
          </span>
        ) : (
          "Your line"
        )
      }
      meta={
        <>
          {view ? (
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden size={14} />
              {view.line.sectorName}
            </span>
          ) : null}
          <span>
            {WEEKDAYS[dayOfWeek(parseCalendarDate(shown))]} ·{" "}
            {formatBusinessDate(shown)}
          </span>
          {view?.day ? (
            view.day.day.kind === "WORKING" ? (
              <StatusBadge kind="day" value={view.day.status} />
            ) : (
              <StatusBadge kind="dayKind" value={view.day.day.kind} />
            )
          ) : null}
          {generatedAt ? <LiveStamp at={generatedAt} /> : null}
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
                router.push(
                  value === today ? "/dashboard" : `/dashboard?date=${value}`,
                );
              }}
            />
          </FilterField>
          {view ? (
            <ExportMenu
              route={exportContract.lineDashboard}
              query={{
                lineId: view.line.lineId,
                ...(date ? { date } : {}),
              }}
            />
          ) : null}
          {view ? (
            <Link
              href={`/lines/${view.line.lineId}/day-closes/${view.businessDate}`}
              className={buttonClass("primary")}
            >
              <LockKey aria-hidden size={18} />
              {view.day &&
              (view.day.status === "OPEN" || view.day.status === "REOPENED")
                ? "Close the day"
                : "Open day close"}
            </Link>
          ) : null}
        </div>
      }
    />
  );

  if (future) {
    return (
      <>
        {header(null, null)}
        <FormMessage tone="info">
          The dashboard shows today or an earlier day. Pick another date.
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
          <NotPermitted description="The line dashboard is for the line’s Senior." />
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

  const data = query.data;
  if (data.state === "NO_LINE") {
    return (
      <>
        {header(null, data.generatedAt)}
        <EmptyFrame>
          <NothingYet
            title="You have no line today"
            description="Your line’s collections, Juniors and cash appear here once an Admin assigns you to a line."
          />
        </EmptyFrame>
      </>
    );
  }

  const day = data.day;
  const cashRows = cash.status === "ready" ? cash.data.data : null;
  const points =
    trend.status === "ready" && trend.data.points ? trend.data.points : null;

  if (phone) {
    // Stitch "Rasi Senior Home (Android M3)": the line card, the menu, what
    // waits on the Senior, their Juniors, and "Close the day" — nothing else.
    const dayClose = `/lines/${data.line.lineId}/day-closes/${data.businessDate}`;
    const open =
      day !== null && (day.status === "OPEN" || day.status === "REOPENED");
    const onDate = (value: string) =>
      router.push(value === today ? "/dashboard" : `/dashboard?date=${value}`);
    return (
      <>
        {day && day.day.kind !== "WORKING" ? (
          <FormMessage tone="info">
            {day.day.kind === "SUNDAY"
              ? "Sunday: no collections are due."
              : `Holiday: ${day.day.name}. No collections are due.`}
          </FormMessage>
        ) : null}
        <LineSummary
          view={data}
          day={day}
          shown={shown}
          today={today}
          onDate={onDate}
        />
        {day === null ? (
          <LoadFailed
            message="The day’s figures, Juniors and entries couldn’t be read just now, so they are not shown."
            onRetry={query.reload}
          />
        ) : null}
        <section aria-labelledby="home-menu" className="flex flex-col gap-2">
          <SectionHeader id="home-menu" variant="overline" title="Menu" />
          <MenuGrid
            variant="tiles"
            items={homeMenu("SENIOR", {
              line: {
                lineId: data.line.lineId,
                businessDate: data.businessDate,
              },
            })}
            counts={{
              approvals: data.pendingApprovals?.total ?? null,
              handovers: day?.handovers.waiting ?? null,
            }}
          />
        </section>
        {day === null ? null : (
          <>
            <PhoneWaiting
              view={data}
              day={day}
              cashRows={cashRows}
              dayClose={dayClose}
            />
            <JuniorCards
              day={day}
              cashRows={cashRows}
              cashFailed={cash.status === "error"}
            />
          </>
        )}
        <StickyAction>
          <Link
            href={dayClose}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-pill bg-accent text-heading font-semibold text-accent-ink shadow-popover transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            <LockKey aria-hidden size={20} />
            {open ? "Close the day" : "Open day close"}
          </Link>
        </StickyAction>
      </>
    );
  }

  return (
    <>
      {header(data, data.generatedAt)}
      {day && day.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {day.day.kind === "SUNDAY"
            ? "Sunday: no collections are due."
            : `Holiday: ${day.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}

      {day === null ? (
        <LoadFailed
          message="The day’s figures, Juniors and entries couldn’t be read just now, so they are not shown."
          onRetry={query.reload}
        />
      ) : (
        <>
          <LineHero day={day} />
          <DayCards view={data} day={day} points={points} />
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <MyJuniors
              view={data}
              day={day}
              cashRows={cashRows}
              cashFailed={cash.status === "error"}
            />
            <WaitingOnYou view={data} day={day} />
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Exceptions day={day} />
            <WatchCard
              title="Finishing soon"
              description="Five collections or fewer left"
              list={data.nearingCompletion}
              empty="No account is within five collections of completing."
              kind="nearing"
            />
            <WatchCard
              title="Overdue on this line"
              description="Past their target date"
              list={data.overdue}
              empty="No account on this line is past its target date."
              kind="overdue"
            />
          </div>
        </>
      )}
      <TrendStrip points={points} failed={trend.status === "error"} />
    </>
  );
}

// ------------------------------------------------------------------ the hero

/**
 * The day in three rings — collected of expected, cash acknowledged of
 * collected, phones that have sent everything — and what is still out.
 */
function LineHero({
  day,
  compact = false,
}: {
  day: Day;
  /** The phone home: the three rings in one row, labels under them. */
  compact?: boolean;
}) {
  const sent = day.juniors.filter((junior) => junior.sync === "SENT").length;
  const surplus = !isZeroMoney(day.surplus);
  // Collected but not yet acknowledged by the Senior: still in the Juniors' hands.
  const withJuniors = subtractMoney(day.collected, day.cashReceived);
  const ring = (
    share: number | null,
    label: string,
    title: string,
    value: ReactNode,
    caption: ReactNode,
    text?: string,
  ) => (
    <div
      className={cn(
        "flex min-w-0 gap-3",
        compact ? "flex-col items-center gap-1.5 text-center" : "items-center",
      )}
    >
      <MiniRing surface="hero" share={share} label={label} text={text} />
      <div
        className={cn(
          "flex min-w-0 flex-col gap-0.5",
          compact && "[&>span:nth-child(2)]:text-label",
        )}
      >
        <span className="text-2xs font-medium tracking-[0.08em] uppercase opacity-80">
          {title}
        </span>
        <span className="text-title" data-numeric>
          {value}
        </span>
        <span className="text-caption opacity-75" data-numeric>
          {caption}
        </span>
      </div>
    </div>
  );
  return (
    <section
      aria-label="The line’s day"
      className={cn(
        heroBandClass,
        "grid gap-5 lg:grid-cols-[minmax(0,9fr)_minmax(0,4fr)] lg:items-center",
      )}
    >
      <div
        className={cn(
          "grid gap-4",
          compact ? "grid-cols-3 gap-2" : "grid-cols-1 sm:grid-cols-3",
        )}
      >
        {ring(
          perMille(day.collected, day.expected),
          "Collected of expected",
          "Collected",
          formatCurrency(day.collected),
          `of ${formatCurrency(day.expected)} due`,
        )}
        {ring(
          day.cashHandedOver ? perMille(day.cashReceived, day.collected) : null,
          "Cash received of collected",
          "Cash in hand",
          formatCurrency(day.cashReceived),
          day.cashHandedOver ? "handed over to you" : "nothing handed over yet",
        )}
        {ring(
          countShare(sent, day.juniors.length),
          "Juniors whose phones sent everything",
          "Phones synced",
          day.juniors.length === 0 ? (
            <HeroUnknown />
          ) : (
            `${sent} of ${day.juniors.length}`
          ),
          day.juniors.length === sent
            ? "everything sent"
            : `${day.juniors.length - sent} still to send`,
          `${sent}/${day.juniors.length}`,
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 rounded-surface bg-accent-ink/10 p-3">
          <dt className="text-2xs font-medium tracking-[0.08em] uppercase opacity-80">
            {surplus ? "Surplus" : "Short"}
          </dt>
          <dd className="text-title" data-numeric>
            {formatCurrency(surplus ? day.surplus : day.shortfall)}
          </dd>
          <dd className="text-caption opacity-75">
            {surplus ? "over expected" : "expected not collected"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-surface bg-accent-ink/10 p-3">
          <dt className="text-2xs font-medium tracking-[0.08em] uppercase opacity-80">
            With Juniors
          </dt>
          <dd className="text-title" data-numeric>
            {formatCurrency(
              isNegativeMoney(withJuniors) ? "0.00" : withJuniors,
            )}
          </dd>
          <dd className="text-caption opacity-75">not acknowledged yet</dd>
        </div>
      </dl>
    </section>
  );
}

// --------------------------------------------------------------- the cards

function DayCards({
  view,
  day,
  points,
}: {
  view: LineView;
  day: Day;
  points: TrendPoint[] | null;
}) {
  const count = (kinds: Exception["kind"][]) =>
    day.exceptions.filter((entry) => kinds.includes(entry.kind)).length;
  const visits = day.juniors.reduce((sum, junior) => sum + junior.entries, 0);
  const low = count(["LOW", "NO_PAYMENT"]);
  const unvisited = count(["NOT_VISITED", "MISSED"]);
  const share = perMille(day.collected, day.expected);
  const surplus = !isZeroMoney(day.surplus);
  return (
    <section
      aria-label="The day’s figures"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <KpiCard
        label="Expected"
        icon={Target}
        tone="accent"
        value={formatCurrency(day.expected)}
        hint="due on this line"
      />
      <KpiCard
        label="Collected"
        icon={HandCoins}
        tone="positive"
        value={formatCurrency(day.collected)}
        hint={`${visits} ${visits === 1 ? "visit" : "visits"}${share === null ? "" : ` · ${formatPerMille(share)}`}`}
        href={`/collections?from=${view.businessDate}&to=${view.businessDate}&lineId=${view.line.lineId}`}
        aside={points ? <Sparkline points={points} /> : null}
      />
      <KpiCard
        label={surplus ? "Surplus" : "Short"}
        icon={surplus ? TrendUp : HourglassMedium}
        tone={
          surplus ? "info" : isZeroMoney(day.shortfall) ? "accent" : "warning"
        }
        value={formatCurrency(surplus ? day.surplus : day.shortfall)}
        hint={low === 0 ? "nobody paid less" : `${low} paid less or nothing`}
        href={`#${EXCEPTIONS_ANCHOR}`}
      />
      <KpiCard
        label="Not visited"
        icon={Warning}
        tone={unvisited === 0 ? "accent" : "critical"}
        value={unvisited}
        hint={
          unvisited === 0
            ? "every customer due was visited"
            : day.status === "OPEN" || day.status === "REOPENED"
              ? "visit before you close"
              : "marked missed at close"
        }
        href={`#${EXCEPTIONS_ANCHOR}`}
      />
    </section>
  );
}

// ------------------------------------------------------------ the Juniors

interface JuniorRow extends Junior {
  /** The discrepancy report's row for this Junior and day (BR-17), if read. */
  cash: DiscrepancyRow["cash"] | undefined;
}

function MyJuniors({
  view,
  day,
  cashRows,
  cashFailed,
}: {
  view: LineView;
  day: Day;
  cashRows: DiscrepancyRow[] | null;
  cashFailed: boolean;
}) {
  const rows: JuniorRow[] = day.juniors.map((junior) => ({
    ...junior,
    cash:
      cashRows === null
        ? undefined
        : (cashRows.find((row) => row.collectedByUserId === junior.userId)
            ?.cash ?? null),
  }));
  const dayClose = `/lines/${view.line.lineId}/day-closes/${view.businessDate}`;
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="My Juniors"
        actions={
          <span className="text-caption text-ink-muted">
            {day.juniors.length}{" "}
            {day.juniors.length === 1 ? "Junior" : "Juniors"} today
          </span>
        }
      />
      <Card.Body className="pt-2">
        {cashFailed ? (
          <FormMessage tone="critical">
            The Juniors’ cash couldn’t be read just now, so handed over and
            difference show “—”.
          </FormMessage>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-body text-ink-muted">
            No Junior worked this line on this day.
          </p>
        ) : (
          <DataView
            frame="flat"
            caption="My Juniors"
            rows={rows}
            getRowId={(junior) => junior.userId}
            complete
            columns={[
              valueColumn<JuniorRow>({
                id: "junior",
                header: "Junior",
                value: (junior) => junior.name,
              }),
              valueColumn<JuniorRow>({
                id: "entries",
                header: "Visits",
                align: "end",
                value: (junior) => junior.entries,
                cell: (junior) => <span data-numeric>{junior.entries}</span>,
              }),
              moneyColumn<JuniorRow>({
                id: "collected",
                header: "Collected",
                amount: (junior) => junior.collectedAmount,
                card: "headline",
              }),
              moneyColumn<JuniorRow>({
                id: "handed",
                header: "Handed over",
                amount: (junior) => junior.cash?.handedOver ?? "0",
                render: (junior) =>
                  junior.cash === undefined ? (
                    <Unknown />
                  ) : junior.cash === null ? (
                    <span className="text-ink-muted">Nothing yet</span>
                  ) : undefined,
              }),
              moneyColumn<JuniorRow>({
                id: "difference",
                header: "Difference",
                amount: (junior) => junior.cash?.difference ?? "0",
                render: (junior) =>
                  junior.cash ? (
                    <Discrepancy amount={junior.cash.difference} />
                  ) : (
                    <Unknown />
                  ),
              }),
              displayColumn<JuniorRow>({
                id: "phone",
                header: "Phone",
                align: "end",
                card: "status",
                cell: (junior) => (
                  <span
                    className="inline-flex"
                    title={
                      junior.reportedAt
                        ? `Phone checked in at ${formatTimestamp(junior.reportedAt, "clock")}`
                        : "No report from the phone today"
                    }
                  >
                    <StatusBadge
                      kind="sync"
                      value={junior.sync}
                      suffix={
                        junior.sync === "UNSENT" && junior.unsentCount
                          ? `· ${junior.unsentCount}`
                          : undefined
                      }
                    />
                  </span>
                ),
              }),
              displayColumn<JuniorRow>({
                id: "action",
                header: "",
                align: "end",
                cell: (junior) =>
                  junior.cash && !isZeroMoney(junior.cash.awaiting) ? (
                    <Link
                      href={dayClose}
                      className={buttonClass("primary", undefined, "sm")}
                      aria-label={`Acknowledge ${formatCurrency(junior.cash.awaiting)} from ${junior.name}`}
                    >
                      Acknowledge
                    </Link>
                  ) : junior.cash?.state === "DISPUTED" ? (
                    <Link
                      href={dayClose}
                      className={buttonClass("secondary", undefined, "sm")}
                    >
                      Review dispute
                    </Link>
                  ) : null,
              }),
            ]}
          />
        )}
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The Senior home's line card (Stitch "Rasi Senior Home"): the line's code
 * and day state, its name, the sector and date (which opens the date
 * picker), three rings — collected, cash with the Senior, phones synced —
 * and what is short and still with the Juniors.
 */
function LineSummary({
  view,
  day,
  shown,
  today,
  onDate,
}: {
  view: LineView;
  day: Day | null;
  shown: string;
  today: string;
  onDate: (date: string) => void;
}) {
  const sent = day
    ? day.juniors.filter((junior) => junior.sync === "SENT").length
    : 0;
  const withJuniors = day
    ? subtractMoney(day.collected, day.cashReceived)
    : null;
  const surplus = day !== null && !isZeroMoney(day.surplus);
  const ring = (
    share: number | null,
    label: string,
    text: string,
    title: string,
    caption: string,
  ) => (
    <div className="flex flex-col items-center gap-1 text-center">
      <SummaryRing share={share} label={label} text={text} />
      <span className="text-caption font-semibold">{title}</span>
      <span className="text-2xs leading-tight opacity-75" data-numeric>
        {caption}
      </span>
    </div>
  );
  return (
    <SummaryCard label="The line’s day">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-control bg-accent-ink/15 px-2 py-0.5 font-mono text-2xs">
          {view.line.code}
        </span>
        {day && day.day.kind === "WORKING" ? (
          <span className="inline-flex items-center gap-1 rounded-pill border border-positive-bright/30 bg-positive-bright/25 px-2 py-0.5 text-2xs font-medium text-positive-subtle">
            <span
              aria-hidden
              className="size-1.5 rounded-pill bg-positive-bright"
            />
            {day.status === "OPEN"
              ? "Open"
              : day.status === "REOPENED"
                ? "Reopened"
                : day.status === "CLOSED"
                  ? "Closed"
                  : "Tallied"}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-display leading-tight font-semibold">
          {view.line.name}
        </h1>
        <p className="text-caption opacity-75">
          {view.line.sectorName} sector ·{" "}
          <DateTap
            shown={shown}
            today={today}
            onDate={onDate}
            className="underline decoration-accent-ink/40 underline-offset-2"
          >
            {shortDate(shown)}
          </DateTap>
        </p>
      </div>
      {day ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {ring(
              perMille(day.collected, day.expected),
              "Collected of expected",
              (() => {
                const share = perMille(day.collected, day.expected);
                return share === null ? "—" : `${Math.floor(share / 10)}%`;
              })(),
              "Collected",
              `${rupees(day.collected)} / ${rupees(day.expected)}`,
            )}
            {ring(
              day.cashHandedOver
                ? perMille(day.cashReceived, day.collected)
                : null,
              "Cash received of collected",
              day.cashHandedOver
                ? `${Math.floor((perMille(day.cashReceived, day.collected) ?? 0) / 10)}%`
                : "—",
              "Cash with me",
              `${rupees(day.cashReceived)} in bag`,
            )}
            {ring(
              countShare(sent, day.juniors.length),
              "Juniors whose phones sent everything",
              `${sent}/${day.juniors.length}`,
              "Phones synced",
              day.juniors.length === sent
                ? "all sent"
                : `${day.juniors.length - sent} pending`,
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex items-center justify-between gap-2 rounded-surface border border-accent-ink/10 bg-ink/20 px-3 py-2">
              <span className="flex items-center gap-1.5 text-caption font-medium opacity-90">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-pill",
                    surplus ? "bg-positive-bright" : "bg-critical-bright",
                  )}
                />
                {surplus ? "Extra" : "Short"}
              </span>
              <span
                className={cn(
                  "text-caption font-semibold",
                  surplus ? "text-positive-subtle" : "text-critical-subtle",
                )}
                data-numeric
              >
                {rupees(surplus ? day.surplus : day.shortfall)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-surface border border-accent-ink/10 bg-ink/20 px-3 py-2">
              <span className="text-caption font-medium opacity-90">
                With Juniors
              </span>
              <span className="text-caption font-semibold" data-numeric>
                {withJuniors === null || isNegativeMoney(withJuniors)
                  ? rupees("0.00")
                  : rupees(withJuniors)}
              </span>
            </div>
          </div>
        </>
      ) : null}
    </SummaryCard>
  );
}

/**
 * "Waiting on you" (Stitch "Rasi Senior Home"): corrections to decide, each
 * Junior's cash waiting to be acknowledged — with the action in the row —
 * handovers disputed, customers not visited, phones still to send.
 */
function PhoneWaiting({
  view,
  day,
  cashRows,
  dayClose,
}: {
  view: LineView;
  day: Day;
  cashRows: DiscrepancyRow[] | null;
  dayClose: string;
}) {
  const approvals = view.pendingApprovals;
  const rows: HomeRow[] = [];
  if (approvals && approvals.total > 0) {
    rows.push({
      key: "approvals",
      icon: ArrowsLeftRight,
      tone: "critical",
      title: "Corrections to approve",
      subtitle:
        approvals.awaitingYou === approvals.total
          ? "Junior requested adjustments"
          : `${approvals.awaitingYou} for you`,
      trailing: <Chip tone="critical">{approvals.total}</Chip>,
      href: "/collections/pending-approval",
    });
  }
  // One row per Junior whose counted cash waits: the amount and who, and
  // the action itself. Without the cash rows, the day's count stands alone.
  const awaiting = (cashRows ?? []).filter(
    (row) => row.cash !== null && !isZeroMoney(row.cash.awaiting),
  );
  if (awaiting.length > 0) {
    for (const row of awaiting) {
      rows.push({
        key: `handover-${row.collectedByUserId}`,
        icon: HandCoins,
        tone: "warning",
        title: "Handover to acknowledge",
        subtitle: `${rupees(row.cash!.awaiting)} from ${row.collectedByName}`,
        trailing: (
          <Link
            href={dayClose}
            aria-label={`Acknowledge ${formatCurrency(row.cash!.awaiting)} from ${row.collectedByName}`}
            className="rounded-pill bg-accent-hover px-4 py-2 text-label font-semibold text-accent-ink transition-colors hover:bg-accent"
          >
            Acknowledge
          </Link>
        ),
      });
    }
  } else if (day.handovers.waiting > 0) {
    rows.push({
      key: "handovers",
      icon: HandCoins,
      tone: "warning",
      title: "Handovers to acknowledge",
      trailing: <Chip tone="warning">{day.handovers.waiting}</Chip>,
      href: dayClose,
    });
  }
  if (day.handovers.disputed > 0) {
    rows.push({
      key: "disputed",
      icon: HandCoins,
      tone: "critical",
      title: "Handovers disputed",
      subtitle: "Count the cash again with the Junior",
      trailing: <Chip tone="critical">{day.handovers.disputed}</Chip>,
      href: dayClose,
    });
  }
  const unvisited = day.exceptions.filter(
    (entry) => entry.kind === "NOT_VISITED",
  ).length;
  if (unvisited > 0) {
    rows.push({
      key: "unvisited",
      icon: Warning,
      tone: "critical",
      title: "Customers not visited",
      subtitle: "Visit before you close the day",
      trailing: <Chip tone="critical">{unvisited}</Chip>,
      href: `/collections?from=${view.businessDate}&to=${view.businessDate}&lineId=${view.line.lineId}`,
    });
  }
  const unsent = day.juniors.filter((junior) => junior.sync !== "SENT");
  if (unsent.length > 0) {
    rows.push({
      key: "phones",
      icon: CloudArrowUp,
      tone: "warning",
      title: "Phones still to send",
      subtitle: unsent
        .map((junior) =>
          junior.unsentCount
            ? `${junior.name} · ${junior.unsentCount} entries`
            : junior.name,
        )
        .join(", "),
      trailing: <Chip tone="warning">{unsent.length}</Chip>,
      href: dayClose,
    });
  }
  return (
    <section aria-labelledby="waiting-on-you" className="flex flex-col gap-2">
      <SectionHeader
        id="waiting-on-you"
        variant="heading"
        title="Waiting on you"
        chip={
          rows.length > 0 ? (
            <Chip tone="warning">{rows.length} open</Chip>
          ) : null
        }
      />
      {approvals === null ? (
        <FormMessage tone="critical">
          Some checks couldn’t run just now, so this list may be incomplete.
        </FormMessage>
      ) : null}
      <ListCard
        label="Waiting on you"
        rows={rows}
        empty="Nothing is waiting on you before the day can close."
      />
    </section>
  );
}

/**
 * The phone home's Juniors (Stitch "Rasi Senior Home"): one card per Junior —
 * visits and collected, their phone, and their cash against it (BR-17),
 * signed: "Matches", or how far short or over.
 */
function JuniorCards({
  day,
  cashRows,
  cashFailed,
}: {
  day: Day;
  cashRows: DiscrepancyRow[] | null;
  cashFailed: boolean;
}) {
  return (
    <section aria-labelledby="my-juniors" className="flex flex-col gap-2">
      <SectionHeader
        id="my-juniors"
        variant="heading"
        title="My Juniors"
        chip={<Chip tone="accent">{day.juniors.length} active</Chip>}
      />
      {cashFailed ? (
        <FormMessage tone="critical">
          The Juniors’ cash couldn’t be read just now, so whether it matches is
          not shown.
        </FormMessage>
      ) : null}
      {day.juniors.length === 0 ? (
        <p className="rounded-overlay border border-border bg-surface-raised p-4 text-body text-ink-muted shadow-raised">
          No Junior worked this line on this day.
        </p>
      ) : (
        <ul aria-label="My Juniors" className="flex flex-col gap-2.5">
          {day.juniors.map((junior) => {
            const cash =
              cashRows === null
                ? undefined
                : (cashRows.find(
                    (row) => row.collectedByUserId === junior.userId,
                  )?.cash ?? null);
            const initials = junior.name
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const short = cash ? isNegativeMoney(cash.difference) : false;
            return (
              <li
                key={junior.userId}
                className="flex items-center gap-3 rounded-overlay border border-border bg-surface-raised p-3.5 shadow-raised"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-pill text-label font-semibold",
                    junior.sync === "SENT"
                      ? "bg-accent-subtle text-accent"
                      : "bg-warning-subtle text-warning",
                  )}
                >
                  {initials}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="truncate text-label text-ink">
                      <span className="font-semibold">{junior.name}</span>
                      <span className="text-ink-muted"> · Junior</span>
                    </span>
                    <span className="flex gap-1">
                      <Chip
                        tone={junior.sync === "SENT" ? "positive" : "warning"}
                      >
                        {junior.sync === "SENT"
                          ? "All sent"
                          : junior.sync === "UNSENT"
                            ? `Not sent${junior.unsentCount ? ` · ${junior.unsentCount}` : ""}`
                            : "No report"}
                      </Chip>
                      {cash && isZeroMoney(cash.difference) ? (
                        <Chip tone="positive">Matches</Chip>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-caption text-ink-muted" data-numeric>
                    {junior.entries} visits · {rupees(junior.collectedAmount)}{" "}
                    collected
                    {cash && !isZeroMoney(cash.difference) ? (
                      <span
                        className={cn(
                          "font-semibold",
                          short ? "text-critical" : "text-positive",
                        )}
                      >
                        {" "}
                        {short
                          ? `−${rupees(absMoney(cash.difference))} short`
                          : `+${rupees(cash.difference)} over`}
                      </span>
                    ) : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** What stands between the Senior and closing the day. */
function WaitingOnYou({ view, day }: { view: LineView; day: Day }) {
  const dayClose = `/lines/${view.line.lineId}/day-closes/${view.businessDate}`;
  const approvals = view.pendingApprovals;
  const unvisited = day.exceptions.filter(
    (entry) => entry.kind === "NOT_VISITED",
  ).length;
  const unsent = day.juniors.filter((junior) => junior.sync !== "SENT").length;
  const rows: ActionRow[] = [];
  if (approvals && approvals.total > 0) {
    rows.push({
      key: "approvals",
      icon: ArrowsLeftRight,
      tone: "warning",
      label:
        approvals.awaitingYou === approvals.total
          ? "Corrections to approve"
          : `Corrections waiting · ${approvals.awaitingYou} for you`,
      badge: approvals.total,
      href: "/collections/pending-approval",
    });
  }
  if (day.handovers.waiting > 0) {
    rows.push({
      key: "handovers",
      icon: HandCoins,
      tone: "accent",
      label: "Handovers to acknowledge",
      badge: day.handovers.waiting,
      href: dayClose,
    });
  }
  if (day.handovers.disputed > 0) {
    rows.push({
      key: "disputed",
      icon: HandCoins,
      tone: "critical",
      label: "Handovers disputed",
      badge: day.handovers.disputed,
      href: dayClose,
    });
  }
  if (unvisited > 0) {
    rows.push({
      key: "unvisited",
      icon: Warning,
      tone: "critical",
      label: "Customers not visited",
      badge: unvisited,
      href: `#${EXCEPTIONS_ANCHOR}`,
    });
  }
  if (unsent > 0) {
    rows.push({
      key: "phones",
      icon: Warning,
      tone: "warning",
      label: "Phones still to send",
      badge: unsent,
      href: dayClose,
    });
  }
  return (
    <ActionList
      title="Waiting on you"
      rows={rows}
      incomplete={approvals === null}
      empty="Nothing is waiting on you before the day can close."
      footer={
        <p className="rounded-control bg-surface-sunken px-3 py-2 text-caption text-ink-muted">
          Every Junior’s phone must send its collections before you close the
          day.
        </p>
      }
    />
  );
}

// ----------------------------------------------------------- the entries

function Exceptions({ day }: { day: Day }) {
  const entries = day.exceptions;
  return (
    <Card.Root
      surface="flat"
      className="min-w-0 scroll-mt-20"
      id={EXCEPTIONS_ANCHOR}
    >
      <Card.Header
        title="Today’s exceptions"
        actions={
          entries.length > 0 ? (
            <Badge tone="warning">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </Badge>
          ) : null
        }
      />
      <Card.Body className="pt-2">
        {entries.length === 0 ? (
          <p className="text-body text-ink-muted">
            Every collection matched what was expected, and every customer due
            was visited.
          </p>
        ) : (
          <DataView
            frame="flat"
            caption="Today’s exceptions"
            rows={entries}
            getRowId={(entry) =>
              `${entry.kind}-${entry.accountLoanId}-${entry.collectionId ?? ""}`
            }
            complete
            columns={[
              identityColumn<Exception>({
                header: "Customer",
                name: (entry) => entry.customerName,
                code: (entry) => entry.accountCode,
                href: (entry) =>
                  entry.collectionId
                    ? `/collections/${entry.collectionId}`
                    : `/accounts/${entry.accountLoanId}`,
              }),
              moneyColumn<Exception>({
                id: "expected",
                header: "Due",
                amount: (entry) => entry.expectedAmount,
              }),
              moneyColumn<Exception>({
                id: "paid",
                header: "Paid",
                amount: (entry) => entry.amount ?? "0",
                render: (entry) =>
                  entry.amount === null ? (
                    <span data-numeric>—</span>
                  ) : (
                    <span data-numeric>
                      {formatCurrency(entry.amount)}{" "}
                      <span className="text-caption text-ink-muted">
                        {signedCurrency(
                          subtractMoney(entry.amount, entry.expectedAmount),
                        )}
                      </span>
                    </span>
                  ),
                card: "headline",
              }),
              displayColumn<Exception>({
                id: "kind",
                header: "Status",
                align: "end",
                card: "status",
                cell: (entry) =>
                  entry.kind === "MISSED" ? (
                    <StatusBadge kind="slot" value="MISSED" />
                  ) : entry.kind === "NOT_VISITED" ? (
                    <Badge tone="neutral">Not visited yet</Badge>
                  ) : (
                    <StatusBadge kind="classification" value={entry.kind} />
                  ),
              }),
              valueColumn<Exception>({
                id: "by",
                header: "Junior",
                value: (entry) => entry.collectedByName ?? "",
              }),
            ]}
          />
        )}
      </Card.Body>
    </Card.Root>
  );
}

function WatchCard({
  title,
  description,
  list,
  empty,
  kind,
}: {
  title: string;
  description: string;
  list: LineView["overdue"];
  empty: string;
  kind: "overdue" | "nearing";
}) {
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title={title}
        actions={
          list && list.total > 0 ? (
            <Badge tone="neutral">{list.total}</Badge>
          ) : null
        }
      />
      <Card.Body className="pt-1">
        <p className="text-caption text-ink-muted">{description} · as of now</p>
        {list === null ? (
          <FormMessage tone="critical">
            These accounts couldn’t be read just now.
          </FormMessage>
        ) : list.total === 0 ? (
          <p className="text-body text-ink-muted">{empty}</p>
        ) : (
          <ul
            aria-label={title}
            className="flex flex-col divide-y divide-border"
          >
            {list.items.slice(0, 6).map((account) => (
              <WatchRow
                key={account.accountLoanId}
                account={account}
                kind={kind}
              />
            ))}
          </ul>
        )}
        {list && list.total > Math.min(list.items.length, 6) ? (
          kind === "overdue" ? (
            <Link href="/reports/overdue" className={arrowLinkClass}>
              All {list.total} in the overdue report
              <ArrowRight aria-hidden size={14} />
            </Link>
          ) : (
            <p className="text-caption text-ink-muted">
              Showing {Math.min(list.items.length, 6)} of {list.total}.
            </p>
          )
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

function WatchRow({
  account,
  kind,
}: {
  account: WatchedAccount;
  kind: "overdue" | "nearing";
}) {
  return (
    <li>
      <Link
        href={`/accounts/${account.accountLoanId}`}
        className="flex items-start justify-between gap-3 py-2 hover:text-accent"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-label text-ink">
            {account.customerName}
          </span>
          <span
            className={cn(
              "text-caption",
              kind === "overdue" ? "text-critical" : "text-ink-muted",
            )}
            data-numeric
          >
            {kind === "overdue"
              ? `${account.daysOverdue} ${account.daysOverdue === 1 ? "day" : "days"} past target`
              : `ends ${formatBusinessDate(account.targetCompletionDate, "day-month")}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={cn(
              "text-label",
              kind === "overdue" ? "text-critical" : "text-ink",
            )}
            data-numeric
          >
            {formatCurrency(account.outstanding)}
          </span>
          <span className="text-caption text-ink-muted">
            {account.accountCode}
          </span>
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------- the line trend

/**
 * The line's last working days in one strip: a sparkline and the share of
 * expected collected over the whole window, summed in exact paise.
 */
function TrendStrip({
  points,
  failed,
}: {
  points: TrendPoint[] | null;
  failed: boolean;
}) {
  const expected = points
    ? sumMoney(points.map((point) => point.expected))
    : null;
  const collected = points
    ? sumMoney(points.map((point) => point.collected))
    : null;
  const share =
    expected !== null && collected !== null
      ? perMille(collected, expected)
      : null;
  return (
    <section
      aria-label="Line trend"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-tile border border-border bg-surface-raised px-4 py-3"
    >
      <span className="flex flex-col">
        <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          Line trend
        </span>
        <span className="text-label text-ink">
          Last {points?.length ?? "—"} working days
        </span>
      </span>
      <span className="text-heading text-accent" data-numeric>
        {share === null ? (
          failed ? (
            <Unknown />
          ) : (
            "—"
          )
        ) : (
          `${formatPerMille(share)} collected`
        )}
      </span>
      {points ? <Sparkline points={points} className="h-8 w-40 grow" /> : null}
      {failed ? (
        <span className="text-caption text-ink-muted">{UNAVAILABLE}</span>
      ) : null}
    </section>
  );
}
