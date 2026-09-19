"use client";

import {
  ArrowRight,
  ArrowsLeftRight,
  HandCoins,
  HourglassMedium,
  LockKey,
  Money,
  Target,
  TrendUp,
} from "@phosphor-icons/react/dist/ssr";
import {
  dashboardContract,
  type LineDashboard as Dashboard,
  type WatchedAccount,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  Badge,
  buttonClass,
  DataView,
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
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../components/columns";
import { Discrepancy, signedCurrency } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import { formatTimestamp } from "../../../lib/format";
import {
  formatPerMille,
  isNegativeMoney,
  isZeroMoney,
  perMille,
  subtractMoney,
} from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";
import {
  countShare,
  LiveStamp,
  Meter,
  ShareRing,
  UNAVAILABLE,
  Unknown,
  WEEKDAYS,
} from "./dashboard-parts";
import { collectedDelta, TrendCard, useTrend } from "./trend-card";

type LineView = Extract<Dashboard, { state: "LINE" }>;
type Day = NonNullable<LineView["day"]>;
type Junior = Day["juniors"][number];
type Exception = Day["exceptions"][number];

/**
 * S-19 · Senior line dashboard (US-083): the Senior's current line for one
 * day — the day close's figures (S-05), each Junior's phone, the entries that
 * need a look, and the accounts close to done or past their target. A figure
 * the API could not compute shows "—" (S-07).
 */
export function LineDashboard({ date }: { date: string | undefined }) {
  const router = useRouter();
  const today = toBusinessDate(new Date());
  const shown = date ?? today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getLine,
    future ? null : { query: date ? { date } : {} },
  );
  // The line's own trend, once the line is known: never a line the page isn't showing.
  const line =
    query.status === "ready" && query.data.state === "LINE"
      ? query.data.line
      : null;
  const trend = useTrend(line ? shown : null, line?.lineId);

  const header = (view: LineView | null, generatedAt: string | null) => (
    <PageHeader
      frame="hero"
      title={view ? view.line.name : "Your line"}
      summary={view?.day ? <DayRings day={view.day} /> : null}
      meta={
        <>
          {view ? <span>{view.line.code}</span> : null}
          {view ? <span>{view.line.sectorName}</span> : null}
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
            <Link
              href={`/lines/${view.line.lineId}/day-closes/${view.businessDate}`}
              className={buttonClass("primary")}
            >
              <LockKey aria-hidden size={18} />
              Open day close
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

      <DayFigures day={day} delta={collectedDelta(trend, shown)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendCard trend={trend} scope={data.line.name} />
        <LineHealth view={data} day={day} />
      </div>
      {day === null ? (
        <LoadFailed
          message="The day’s Juniors and entries couldn’t be read just now, so they are not shown."
          onRetry={query.reload}
        />
      ) : (
        <>
          <JuniorsToday juniors={day.juniors} />
          <NeedsALook view={data} day={day} />
        </>
      )}
      <AccountsToWatch view={data} />
    </>
  );
}

/** The hero's rings: collected, cash in hand once any was handed over, Juniors synced. */
function DayRings({ day }: { day: Day }) {
  const sent = day.juniors.filter((junior) => junior.sync === "SENT").length;
  return (
    <>
      <ShareRing
        share={perMille(day.collected, day.expected)}
        label="Collected of expected"
        caption="Collected"
      />
      {day.cashHandedOver ? (
        <ShareRing
          share={perMille(day.cashReceived, day.collected)}
          label="Cash received of collected"
          caption="Cash in hand"
          tone={isNegativeMoney(day.discrepancy) ? "warning" : "positive"}
        />
      ) : null}
      <ShareRing
        share={countShare(sent, day.juniors.length)}
        label="Juniors whose phones sent everything"
        caption="Phones synced"
        tone="positive"
      />
    </>
  );
}

/** Beside the trend: the cash handed over, and corrections waiting. */
function LineHealth({ view, day }: { view: LineView; day: Day | null }) {
  const approvals = view.pendingApprovals;
  return (
    <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <HealthCard.Root>
        <HealthCard.Header
          icon={<HandCoins />}
          tone={day && day.handovers.disputed > 0 ? "critical" : "accent"}
          title="Handovers"
          subtitle="Junior to Senior, this day"
          value={
            day === null ? null : day.handovers.disputed > 0 ? (
              <Badge shape="pill" tone="critical">
                {day.handovers.disputed} disputed
              </Badge>
            ) : day.handovers.waiting > 0 ? (
              <Badge shape="pill" tone="warning">
                {day.handovers.waiting} waiting
              </Badge>
            ) : (
              <Badge
                shape="pill"
                tone={day.cashHandedOver ? "positive" : "neutral"}
              >
                {day.cashHandedOver ? "Received" : "None yet"}
              </Badge>
            )
          }
        />
        <HealthCard.Detail>
          {day === null ? (
            UNAVAILABLE
          ) : day.cashHandedOver ? (
            <>
              {formatCurrency(day.cashReceived)} received ·{" "}
              <Discrepancy amount={day.discrepancy} />
            </>
          ) : (
            "Nothing handed over yet."
          )}
        </HealthCard.Detail>
      </HealthCard.Root>
      <HealthCard.Root>
        <HealthCard.Header
          icon={<ArrowsLeftRight />}
          tone="warning"
          title="Corrections"
          subtitle="waiting for approval on this line"
          value={
            approvals === null ? null : (
              <Badge
                shape="pill"
                tone={approvals.total > 0 ? "warning" : "neutral"}
                mark="none"
              >
                {approvals.total}
              </Badge>
            )
          }
        />
        <HealthCard.Detail>
          <Link
            href="/collections/pending-approval"
            className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
          >
            {approvals === null
              ? "Pending approvals"
              : approvals.awaitingYou > 0
                ? `${approvals.awaitingYou} waiting for you`
                : "Pending approvals"}
            <ArrowRight aria-hidden size={14} />
          </Link>
        </HealthCard.Detail>
      </HealthCard.Root>
    </div>
  );
}

function DayFigures({ day, delta }: { day: Day | null; delta: ReactNode }) {
  const share = day ? perMille(day.collected, day.expected) : null;
  const surplus = day !== null && !isZeroMoney(day.surplus);
  return (
    <StatGrid columns={4} frame="tiles" aria-label="The line’s day">
      <Stat
        label="Expected"
        icon={<Target />}
        hint={day ? "due on this line" : UNAVAILABLE}
      >
        {day ? formatCurrency(day.expected) : <Unknown />}
      </Stat>
      <Stat
        label="Collected"
        icon={<HandCoins />}
        iconTone="positive"
        delta={day ? delta : null}
        hint={
          day ? (
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
        {day ? formatCurrency(day.collected) : <Unknown />}
      </Stat>
      <Stat
        label={surplus ? "Surplus" : "Shortfall"}
        icon={surplus ? <TrendUp /> : <HourglassMedium />}
        iconTone={surplus ? "info" : "warning"}
        tone={day && !isZeroMoney(day.shortfall) ? "warning" : "neutral"}
        hint={
          day
            ? surplus
              ? "collected over expected"
              : "expected not yet collected"
            : UNAVAILABLE
        }
      >
        {day ? (
          formatCurrency(surplus ? day.surplus : day.shortfall)
        ) : (
          <Unknown />
        )}
      </Stat>
      <Stat
        label="Cash received"
        icon={<Money />}
        iconTone="neutral"
        hint={
          day === null ? (
            UNAVAILABLE
          ) : (
            <span className="flex flex-wrap items-center gap-x-2">
              {day.cashHandedOver ? (
                <Discrepancy amount={day.discrepancy} />
              ) : (
                // Nothing handed over yet is not a shortage (S-05).
                <span>not handed over yet</span>
              )}
              {day.handovers.waiting > 0 ? (
                <span>· {day.handovers.waiting} waiting</span>
              ) : null}
              {day.handovers.disputed > 0 ? (
                <span className="text-critical">
                  · {day.handovers.disputed} disputed
                </span>
              ) : null}
            </span>
          )
        }
      >
        {day ? formatCurrency(day.cashReceived) : <Unknown />}
      </Stat>
    </StatGrid>
  );
}

function JuniorsToday({ juniors }: { juniors: Junior[] }) {
  return (
    <Section
      title="Juniors today"
      description="What each Junior recorded, and whether their phone has sent it all."
    >
      {juniors.length === 0 ? (
        <p className="text-body text-ink-muted">
          No Junior worked this line on this day.
        </p>
      ) : (
        <DataView
          frame="flat"
          caption="Juniors today"
          rows={juniors}
          getRowId={(junior) => junior.userId}
          complete
          columns={[
            valueColumn<Junior>({
              id: "junior",
              header: "Junior",
              value: (junior) => junior.name,
            }),
            valueColumn<Junior>({
              id: "entries",
              header: "Entries",
              align: "end",
              value: (junior) => junior.entries,
              cell: (junior) => <span data-numeric>{junior.entries}</span>,
            }),
            moneyColumn<Junior>({
              id: "collected",
              header: "Collected",
              amount: (junior) => junior.collectedAmount,
            }),
            displayColumn<Junior>({
              id: "phone",
              header: "Phone sync",
              align: "end",
              cell: (junior) => (
                <span className="inline-flex flex-col items-end gap-0.5">
                  <StatusBadge
                    kind="sync"
                    value={junior.sync}
                    suffix={
                      junior.sync === "UNSENT" && junior.unsentCount
                        ? `· ${junior.unsentCount}`
                        : undefined
                    }
                  />
                  {junior.reportedAt ? (
                    <span className="text-caption text-ink-muted">
                      checked {formatTimestamp(junior.reportedAt, "clock")}
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

function NeedsALook({ view, day }: { view: LineView; day: Day }) {
  const entries = day.exceptions;
  const approvals = view.pendingApprovals;
  return (
    <Section
      title="Needs a look"
      description="Low, extra and no-payment entries, and customers not visited or missed."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {entries.length > 0 ? (
            <Badge tone="warning">
              {entries.length} {entries.length === 1 ? "item" : "items"}
            </Badge>
          ) : null}
          {approvals === null ? (
            <Link
              href="/collections/pending-approval"
              className="text-label text-accent underline-offset-4 hover:underline"
            >
              Pending approvals
            </Link>
          ) : approvals.total > 0 ? (
            <Link
              href="/collections/pending-approval"
              className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
            >
              {approvals.total}{" "}
              {approvals.total === 1 ? "correction" : "corrections"} waiting
              <ArrowRight aria-hidden size={14} />
            </Link>
          ) : null}
        </div>
      }
    >
      {entries.length === 0 ? (
        <p className="text-body text-ink-muted">
          Every collection matched what was expected, and every customer due was
          visited.
        </p>
      ) : (
        <DataView
          frame="flat"
          caption="Entries that need a look"
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
              header: "Expected",
              amount: (entry) => entry.expectedAmount,
            }),
            moneyColumn<Exception>({
              id: "paid",
              header: "Collected",
              // An unvisited or missed slot sorts as nothing paid.
              amount: (entry) => entry.amount ?? "0",
              render: (entry) =>
                entry.amount === null ? <span data-numeric>—</span> : undefined,
            }),
            moneyColumn<Exception>({
              id: "variance",
              header: "Variance",
              amount: (entry) => variance(entry),
              render: (entry) => (
                <span data-numeric>{signedCurrency(variance(entry))}</span>
              ),
            }),
            displayColumn<Exception>({
              id: "kind",
              header: "Classification",
              align: "end",
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
              header: "Recorded by",
              value: (entry) => entry.collectedByName ?? "",
            }),
          ]}
        />
      )}
    </Section>
  );
}

/** Collected − expected; a slot with nothing collected is the whole amount short. */
function variance(entry: Exception): string {
  return subtractMoney(entry.amount ?? "0", entry.expectedAmount);
}

function AccountsToWatch({ view }: { view: LineView }) {
  return (
    <div className="grid gap-[var(--section-gap)] lg:grid-cols-2">
      <WatchList
        title="Overdue"
        description="Past their target date with money still to collect. As of now."
        list={view.overdue}
        empty="No account on this line is past its target date."
        kind="overdue"
      />
      <WatchList
        title="Nearing completion"
        description="Five daily collections or fewer left. As of now."
        list={view.nearingCompletion}
        empty="No account is within five collections of completing."
        kind="nearing"
      />
    </div>
  );
}

function WatchList({
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
    <Section
      title={title}
      description={description}
      actions={
        list && list.total > 0 ? (
          <Badge tone="neutral">{list.total}</Badge>
        ) : null
      }
    >
      {list === null ? (
        <FormMessage tone="critical">
          These accounts couldn’t be read just now.
        </FormMessage>
      ) : list.total === 0 ? (
        <p className="text-body text-ink-muted">{empty}</p>
      ) : (
        <>
          <DataView
            frame="flat"
            caption={title}
            rows={list.items}
            getRowId={(account) => account.accountLoanId}
            complete
            columns={[
              identityColumn<WatchedAccount>({
                header: "Customer",
                name: (account) => account.customerName,
                code: (account) => account.accountCode,
                href: (account) => `/accounts/${account.accountLoanId}`,
              }),
              moneyColumn<WatchedAccount>({
                id: "outstanding",
                header: "Outstanding",
                amount: (account) => account.outstanding,
              }),
              kind === "overdue"
                ? valueColumn<WatchedAccount>({
                    id: "late",
                    header: "Days over",
                    align: "end",
                    value: (account) => account.daysOverdue,
                    cell: (account) => (
                      <span data-numeric className="text-warning">
                        {account.daysOverdue}
                      </span>
                    ),
                  })
                : valueColumn<WatchedAccount>({
                    id: "target",
                    header: "Target",
                    align: "end",
                    value: (account) => account.targetCompletionDate,
                    cell: (account) =>
                      formatBusinessDate(account.targetCompletionDate),
                  }),
            ]}
          />
          {list.total > list.items.length ? (
            <p className="text-caption text-ink-muted">
              Showing the first {list.items.length} of {list.total}.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}
