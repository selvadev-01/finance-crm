"use client";

import {
  AddressBook,
  ArrowRight,
  ArrowsLeftRight,
  Bank,
  CalendarX,
  CaretRight,
  HandCoins,
  HourglassMedium,
  LockOpen,
  SealCheck,
  Target,
  TrendUp,
  UserMinus,
  UserPlus,
  Wallet,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  type AttentionItem,
  dashboardContract,
  type LineToday,
  type OperationsDashboard as Dashboard,
  type SectorToday,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  ActivityList,
  Badge,
  buttonClass,
  Card,
  cn,
  CodeChip,
  DataView,
  DetailSkeleton,
  EmptyFrame,
  FilterField,
  flatSurfaceClass,
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
import { Discrepancy, Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import { formatPerMille, isZeroMoney, perMille } from "../../../lib/money";
import { canOnboard } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
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

/**
 * S-20 · Admin operational dashboard (US-082, PDF §21): today's money across
 * the lines, what needs someone, each line's day, then the running totals.
 * Every figure the API could not compute shows "—".
 */
export function OperationsDashboard({ date }: { date: string | undefined }) {
  const router = useRouter();
  const today = toBusinessDate(new Date());
  const shown = date ?? today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getOperations,
    future ? null : { query: date ? { date } : {} },
  );
  const trend = useTrend(future ? null : shown);

  const header = (view: Dashboard | null) => (
    <PageHeader
      frame="hero"
      title={shown === today ? "Today" : formatBusinessDate(shown)}
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
        view?.today ? (
          <>
            <ShareRing
              share={perMille(view.today.collected, view.today.expected)}
              label="Collected of expected"
              caption="Collected"
            />
            <ShareRing
              share={countShare(
                view.today.linesToClose - view.today.linesNotClosed,
                view.today.linesToClose,
              )}
              label="Lines closed"
              caption="Lines closed"
              tone="positive"
            />
          </>
        ) : null
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
              router.push(
                value === today ? "/dashboard" : `/dashboard?date=${value}`,
              );
            }}
          />
        </FilterField>
      }
    />
  );

  if (future) {
    return (
      <>
        {header(null)}
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
          <NotPermitted description="The business-wide dashboard is for Admins." />
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
  if (view.lines !== null && view.lines.length === 0) {
    return (
      <>
        {header(view)}
        <EmptyFrame>
          <NothingYet
            title="Set up the business first"
            description="Figures appear here once there are sectors and lines to collect on."
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
        <AgainstExpected view={view} />
      </div>

      <div className="grid gap-[var(--section-gap)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <NeedsAttention view={view} onRetry={query.reload} />
        <QuickActions pending={view.pendingApprovals?.total ?? null} />
      </div>

      <LinesToday view={view} />
      <SectorsToday sectors={view.sectors} date={view.businessDate} />
      <RunningTotals view={view} />
    </>
  );
}

function TodayFigures({ view, delta }: { view: Dashboard; delta: ReactNode }) {
  const today = view.today;
  const approvals = view.pendingApprovals;
  const share = today ? perMille(today.collected, today.expected) : null;
  return (
    <>
      <StatGrid columns={4} frame="tiles" aria-label="Today’s collections">
        <Stat
          label="Expected"
          icon={<Target />}
          hint={
            today
              ? `across ${today.linesToClose} ${today.linesToClose === 1 ? "line" : "lines"} collecting`
              : UNAVAILABLE
          }
        >
          {today ? formatCurrency(today.expected) : <Unknown />}
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
          {today ? formatCurrency(today.collected) : <Unknown />}
        </Stat>
        <Stat
          label="Pending approvals"
          icon={<ArrowsLeftRight />}
          iconTone="warning"
          tone={approvals && approvals.total > 0 ? "warning" : "neutral"}
          hint={
            approvals
              ? approvals.total === 0
                ? "no corrections waiting"
                : `${approvals.awaitingYou} waiting for you`
              : UNAVAILABLE
          }
        >
          {approvals ? approvals.total : <Unknown />}
        </Stat>
        <Stat
          label="Lines not closed"
          icon={<LockOpen />}
          iconTone="info"
          hint={
            today
              ? `${today.linesToClose - today.linesNotClosed} of ${today.linesToClose} closed`
              : UNAVAILABLE
          }
        >
          {today ? today.linesNotClosed : <Unknown />}
        </Stat>
      </StatGrid>
    </>
  );
}

/** Beside the trend: how far the day is from expected, and how many entries were off. */
function AgainstExpected({ view }: { view: Dashboard }) {
  const today = view.today;
  if (!today) {
    return (
      <HealthCard.Root aria-label="Against expected">
        <HealthCard.Header title="Against expected" />
        <HealthCard.Detail>{UNAVAILABLE}</HealthCard.Detail>
      </HealthCard.Root>
    );
  }
  const pendingShare = perMille(today.pending, today.expected);
  const extraShare = perMille(today.extra, today.expected);
  return (
    <div
      role="group"
      aria-label="Against expected"
      className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1"
    >
      <HealthCard.Root>
        <HealthCard.Header
          icon={<HourglassMedium />}
          tone="warning"
          title="Pending"
          subtitle="short of expected, line by line"
          value={
            <Badge
              shape="pill"
              tone={isZeroMoney(today.pending) ? "neutral" : "warning"}
              mark="none"
            >
              {formatCurrency(today.pending)}
            </Badge>
          }
        />
        {pendingShare === null ? null : (
          <Meter
            share={pendingShare}
            label="Pending of expected"
            tone="warning"
          />
        )}
        <HealthCard.Detail>
          {today.lowCount} {today.lowCount === 1 ? "customer" : "customers"}{" "}
          paid less than expected
        </HealthCard.Detail>
      </HealthCard.Root>
      <HealthCard.Root>
        <HealthCard.Header
          icon={<TrendUp />}
          tone="info"
          title="Extra"
          subtitle="over expected, line by line"
          value={
            <Badge shape="pill" tone="info" mark="none">
              {formatCurrency(today.extra)}
            </Badge>
          }
        />
        {extraShare === null ? null : (
          <Meter share={extraShare} label="Extra of expected" tone="positive" />
        )}
        <HealthCard.Detail>
          {today.extraCount} {today.extraCount === 1 ? "customer" : "customers"}{" "}
          paid more than expected
        </HealthCard.Detail>
      </HealthCard.Root>
    </div>
  );
}

// ------------------------------------------------------------ needs attention

interface AttentionRowProps {
  tone: "critical" | "warning";
  icon: ReactNode;
  code?: string;
  title: string;
  detail: ReactNode;
  href: string;
  action: string;
}

/** What each item says, and the page that resolves it. */
function attentionRow(item: AttentionItem, date: string): AttentionRowProps {
  switch (item.kind) {
    case "DISPUTED_HANDOVER":
      return {
        tone: "critical",
        icon: <HandCoins aria-hidden size={18} />,
        code: item.lineCode,
        title: `${item.fromName}’s cash for ${formatBusinessDate(item.businessDate)} is disputed`,
        detail: (
          <>
            {item.lineName} · <Discrepancy amount={item.discrepancy} />
          </>
        ),
        href: `/lines/${item.lineId}/day-closes/${item.businessDate}`,
        action: "Open day close",
      };
    case "MISSED":
      return {
        tone: "critical",
        icon: <Warning aria-hidden size={18} />,
        code: item.lineCode,
        title: `${item.lineName} — ${item.count} ${item.count === 1 ? "customer" : "customers"} missed`,
        detail: "Not visited before the day was closed.",
        href: `/lines/${item.lineId}/day-closes/${date}`,
        action: "View day close",
      };
    case "DAY_NOT_CLOSED":
      return {
        tone: "warning",
        icon: <CalendarX aria-hidden size={18} />,
        code: item.lineCode,
        title: `${item.lineName} is not closed for ${formatBusinessDate(date)}`,
        detail:
          item.status === "REOPENED"
            ? "Reopened — close it again once the figures are checked."
            : "The Senior has not closed this day yet.",
        href: `/lines/${item.lineId}/day-closes/${date}`,
        action: "Open day close",
      };
    case "PENDING_APPROVALS":
      return {
        tone: "warning",
        icon: <ArrowsLeftRight aria-hidden size={18} />,
        title: `${item.count} ${item.count === 1 ? "correction" : "corrections"} waiting for approval`,
        detail:
          item.awaitingYou === item.count
            ? "You can decide all of them."
            : `${item.awaitingYou} for you; your own requests need another approver.`,
        href: "/collections/pending-approval",
        action: "Review",
      };
    case "NO_SENIOR":
      return {
        tone: "warning",
        icon: <UserMinus aria-hidden size={18} />,
        code: item.lineCode,
        title: `${item.lineName} has no Senior`,
        detail: "Nobody can close this line’s day or receive its cash.",
        href: `/lines/${item.lineId}`,
        action: "Assign staff",
      };
    case "NO_JUNIOR":
      return {
        tone: "warning",
        icon: <UserMinus aria-hidden size={18} />,
        code: item.lineCode,
        title: `${item.lineName} has no Junior`,
        detail: "It has active accounts and nobody to collect them.",
        href: `/lines/${item.lineId}`,
        action: "Assign staff",
      };
  }
}

function NeedsAttention({
  view,
  onRetry,
}: {
  view: Dashboard;
  onRetry: () => void;
}) {
  const items = view.attention;
  return (
    <Section
      title="Needs attention"
      actions={
        items && items.length > 0 ? (
          <Badge tone="warning">
            {items.length} open {items.length === 1 ? "item" : "items"}
          </Badge>
        ) : null
      }
    >
      {items === null ? (
        <LoadFailed
          message="What needs attention couldn’t be checked just now, so this list is not shown."
          onRetry={onRetry}
        />
      ) : items.length === 0 ? (
        <Card.Root surface="flat">
          <Card.Body>
            <p className="text-body text-ink-muted">
              Nothing needs attention: no disputes, missed customers, waiting
              corrections or unstaffed lines.
            </p>
          </Card.Body>
        </Card.Root>
      ) : (
        <Card.Root surface="flat">
          <Card.Body>
            <ActivityList.Root aria-label="Needs attention">
              {items.map((item) => {
                const row = attentionRow(item, view.businessDate);
                return (
                  <ActivityList.Item
                    key={`${item.kind}-${"lineId" in item ? item.lineId : ""}-${"handoverId" in item ? item.handoverId : ""}`}
                  >
                    <ActivityList.Icon tone={row.tone}>
                      {row.icon}
                    </ActivityList.Icon>
                    <ActivityList.Body
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          {row.code ? <CodeChip>{row.code}</CodeChip> : null}
                          <span>{row.title}</span>
                        </span>
                      }
                      meta={row.detail}
                    />
                    <ActivityList.Aside>
                      <Link
                        href={row.href}
                        className="inline-flex items-center gap-1 text-label text-accent underline-offset-4 hover:underline"
                      >
                        {row.action}
                        <ArrowRight aria-hidden size={14} />
                      </Link>
                    </ActivityList.Aside>
                  </ActivityList.Item>
                );
              })}
            </ActivityList.Root>
          </Card.Body>
        </Card.Root>
      )}
    </Section>
  );
}

function QuickActions({ pending }: { pending: number | null }) {
  const me = useSignedIn();
  const action = (href: string, icon: ReactNode, label: ReactNode) => (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-control p-2 text-label text-ink transition-colors hover:bg-ink/5"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent-subtle text-accent">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <CaretRight
        aria-hidden
        size={14}
        className="text-ink-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
  return (
    <Section title="Quick actions">
      <nav
        aria-label="Quick actions"
        className={cn(flatSurfaceClass, "flex flex-col gap-1 p-2")}
      >
        {canOnboard(me.role) ? (
          <>
            {action(
              "/customers/new",
              <UserPlus aria-hidden size={18} />,
              "New customer",
            )}
            {action(
              "/accounts/new",
              <Wallet aria-hidden size={18} />,
              "New account",
            )}
          </>
        ) : null}
        {action(
          "/collections/pending-approval",
          <ArrowsLeftRight aria-hidden size={18} />,
          pending === null
            ? "Pending approvals"
            : `Pending approvals (${pending})`,
        )}
      </nav>
    </Section>
  );
}

// ---------------------------------------------------------------- the lines

function LinesToday({ view }: { view: Dashboard }) {
  const lines = view.lines;
  return (
    <Section
      title="Lines today"
      description="Collected against expected, and whether each line’s day is closed."
    >
      {lines === null ? (
        <FormMessage tone="critical">
          The lines couldn’t be read just now, so their figures are not shown.
        </FormMessage>
      ) : (
        <DataView
          frame="flat"
          caption="Lines today"
          rows={lines}
          getRowId={(line) => line.lineId}
          complete
          columns={[
            identityColumn<LineToday>({
              header: "Line",
              name: (line) => line.name,
              code: (line) => line.code,
              href: (line) => `/lines/${line.lineId}`,
            }),
            valueColumn<LineToday>({
              id: "sector",
              header: "Sector",
              value: (line) => line.sectorName,
            }),
            valueColumn<LineToday>({
              id: "senior",
              header: "Senior",
              value: (line) => line.seniorName ?? "",
              cell: (line) =>
                line.seniorName ?? (
                  <span className="text-warning">No Senior</span>
                ),
            }),
            valueColumn<LineToday>({
              id: "juniors",
              header: "Juniors",
              align: "end",
              value: (line) => line.juniorCount,
              cell: (line) => <span data-numeric>{line.juniorCount}</span>,
            }),
            moneyColumn<LineToday>({
              id: "collected",
              header: "Collected / expected",
              amount: (line) => line.collected,
              render: (line) => <LineProgress line={line} />,
            }),
            displayColumn<LineToday>({
              id: "status",
              header: "Day",
              align: "end",
              cell: (line) =>
                line.day.kind !== "WORKING" ? (
                  <StatusBadge kind="dayKind" value={line.day.kind} />
                ) : (
                  <Link
                    href={`/lines/${line.lineId}/day-closes/${view.businessDate}`}
                    aria-label={`${line.name} day close`}
                    className="inline-flex"
                  >
                    <StatusBadge
                      kind="day"
                      value={line.status}
                      suffix={
                        line.missedCount > 0
                          ? `· ${line.missedCount} missed`
                          : undefined
                      }
                    />
                  </Link>
                ),
            }),
          ]}
        />
      )}
    </Section>
  );
}

function LineProgress({ line }: { line: LineToday }) {
  const share = perMille(line.collected, line.expected);
  return (
    <span className="flex flex-col items-end gap-1">
      <span data-numeric>
        <Money amount={line.collected} />
        <span className="text-ink-muted">
          {" / "}
          <Money amount={line.expected} />
        </span>
      </span>
      {share === null ? null : (
        <span className="w-24">
          <Meter share={share} label={`${line.name} collected of expected`} />
        </span>
      )}
    </span>
  );
}

function SectorsToday({
  sectors,
  date,
}: {
  sectors: SectorToday[] | null;
  date: string;
}) {
  return (
    <Section title="Sectors" actions={<CompareSectorsLink date={date} />}>
      {sectors === null ? (
        <FormMessage tone="critical">
          The sector breakdown couldn’t be worked out just now.
        </FormMessage>
      ) : (
        <DataView
          frame="flat"
          caption="Sectors today"
          rows={sectors}
          getRowId={(sector) => sector.sectorId}
          complete
          columns={[
            identityColumn<SectorToday>({
              header: "Sector",
              name: (sector) => sector.name,
              code: (sector) => sector.code,
              href: (sector) => `/sectors/${sector.sectorId}`,
            }),
            valueColumn<SectorToday>({
              id: "lines",
              header: "Lines",
              align: "end",
              value: (sector) => sector.lineCount,
              cell: (sector) => <span data-numeric>{sector.lineCount}</span>,
            }),
            valueColumn<SectorToday>({
              id: "accounts",
              header: "Active accounts",
              align: "end",
              value: (sector) => sector.activeAccounts,
              cell: (sector) => (
                <span data-numeric>{sector.activeAccounts}</span>
              ),
            }),
            moneyColumn<SectorToday>({
              id: "expected",
              header: "Expected",
              amount: (sector) => sector.expected,
            }),
            moneyColumn<SectorToday>({
              id: "collected",
              header: "Collected",
              amount: (sector) => sector.collected,
            }),
          ]}
        />
      )}
    </Section>
  );
}

// ------------------------------------------------------- the running totals

function RunningTotals({ view }: { view: Dashboard }) {
  const { customers, accounts, investment } = view;
  return (
    <>
      <Section title="Customers and accounts">
        <StatGrid columns={4} frame="tiles">
          <Stat
            label="New customers"
            icon={<UserPlus />}
            iconTone="neutral"
            hint={customers ? "onboarded this day" : UNAVAILABLE}
          >
            {customers ? customers.new : <Unknown />}
          </Stat>
          <Stat
            label="Active customers"
            icon={<AddressBook />}
            iconTone="neutral"
            hint={customers ? "with an active account" : UNAVAILABLE}
          >
            {customers ? customers.active : <Unknown />}
          </Stat>
          <Stat
            label="Active accounts"
            icon={<Wallet />}
            iconTone="neutral"
            hint={accounts ? `of ${accounts.total} accounts` : UNAVAILABLE}
          >
            {accounts ? accounts.active : <Unknown />}
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
      <Section
        title="Investment"
        description="Every account disbursed, from the ledger."
      >
        <StatGrid columns={2} frame="tiles">
          <Stat
            label="Invested"
            icon={<Bank />}
            iconTone="neutral"
            hint={investment ? undefined : UNAVAILABLE}
          >
            {investment ? formatCurrency(investment.invested) : <Unknown />}
          </Stat>
          <Stat
            label="Profit"
            icon={<TrendUp />}
            iconTone="neutral"
            hint={investment ? undefined : UNAVAILABLE}
          >
            {investment ? formatCurrency(investment.profit) : <Unknown />}
          </Stat>
        </StatGrid>
      </Section>
    </>
  );
}
