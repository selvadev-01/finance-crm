"use client";

import {
  ArrowRight,
  ArrowsLeftRight,
  CaretRight,
  Receipt,
  UserPlus,
  Wallet,
} from "@phosphor-icons/react/dist/ssr";
import {
  booksMoneyContract,
  dashboardContract,
  exportContract,
  type LineToday,
  type OperationsDashboard as Dashboard,
  type SectorToday,
  statementsContract,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  arrowLinkClass,
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
  Skeleton,
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
import { AccountsAwaitingApproval } from "../../../components/accounts-awaiting-approval";
import { ExportMenu } from "../../../components/export-menu";
import { Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import {
  formatPerMille,
  isNegativeMoney,
  isZeroMoney,
  perMille,
  subtractMoney,
  sumMoney,
} from "../../../lib/money";
import { type ConsoleRole, homeMenu } from "../../../lib/home-menu";
import { canManageOrganisation, canOnboard } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import {
  CompareSectorsLink,
  LiveStamp,
  Meter,
  UNAVAILABLE,
  Unknown,
  WEEKDAYS,
} from "./dashboard-parts";
import {
  ActionList,
  attentionRows,
  Compact,
  heroBandClass,
  HeroUnknown,
  HeroStat,
  type Icon,
  KPI_ICON,
  type KpiTone,
  MiniRing,
  pendingExpensesRow,
} from "./dashboard-visuals";
import {
  Bar,
  Chip,
  DateTap,
  HeaderLink,
  homeRows,
  ListCard,
  MenuGrid,
  rupees,
  SectionHeader,
  shortDate,
  StickyAction,
  SummaryCard,
  SummaryRing,
  SummaryStats,
  usePhoneLayout,
} from "./phone-home";
import { TrendCard, useTrend } from "./trend-card";

/**
 * S-20 · Admin operational dashboard (US-082, PDF §21; Stitch "Today's
 * operations", 2026-10-02): the Admin runs the day across every line. The
 * teal hero is the day at a glance; then what needs someone and the quick
 * ways to act, each line's day beside the trend, and the sectors, the books
 * and the customer counts. Every figure the API could not compute shows "—".
 */
export function OperationsDashboard({ date }: { date: string | undefined }) {
  const router = useRouter();
  const me = useSignedIn();
  const books = canManageOrganisation(me.role);
  const phone = usePhoneLayout();
  const today = toBusinessDate(new Date());
  const shown = date ?? today;
  const future = shown > today;
  const query = useApiQuery(
    dashboardContract.getOperations,
    future ? null : { query: date ? { date } : {} },
  );
  const trend = useTrend(future ? null : shown);
  const booksOverview = useApiQuery(
    booksMoneyContract.getBooksOverview,
    future || !books ? null : { query: { date: shown } },
  );

  const header = (view: Dashboard | null) => (
    <PageHeader
      title={shown === today ? "Today’s operations" : formatBusinessDate(shown)}
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
          <ExportMenu
            route={exportContract.operationsDashboard}
            query={date ? { date } : {}}
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

  const pendingExpenses =
    booksOverview.status === "ready"
      ? booksOverview.data.month.pendingFieldExpenses
      : null;

  if (phone) {
    // Stitch "Rasi Admin Home (Android M3)": the day in the teal card, the
    // menu, what needs attention, each line as a card, and "New customer".
    const attention = homeRows([
      ...pendingExpensesRow(pendingExpenses),
      ...attentionRows(view.attention ?? [], view.businessDate),
    ]);
    const menu = homeMenu(me.role as ConsoleRole, { line: null });
    const onDate = (value: string) =>
      router.push(value === today ? "/dashboard" : `/dashboard?date=${value}`);
    return (
      <>
        {view.day.kind !== "WORKING" ? (
          <FormMessage tone="info">
            {view.day.kind === "SUNDAY"
              ? "Sunday: no collections are due."
              : `Holiday: ${view.day.name}. No collections are due.`}
          </FormMessage>
        ) : null}
        <DaySummary view={view} shown={shown} today={today} onDate={onDate} />
        <section aria-labelledby="home-menu">
          <MenuGrid
            variant="card"
            items={menu}
            counts={{
              approvals: view.pendingApprovals?.total ?? null,
              expenses: pendingExpenses,
            }}
            header={
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 id="home-menu" className="text-heading text-ink">
                  Menu
                </h2>
                <span className="text-2xs font-medium tracking-wider text-ink-muted uppercase">
                  {menu.length} operations
                </span>
              </div>
            }
          />
        </section>
        <section
          aria-labelledby="needs-attention"
          className="flex flex-col gap-2"
        >
          <SectionHeader
            id="needs-attention"
            variant="heading"
            title="Needs attention"
            chip={
              attention.length > 0 ? (
                <Chip tone="critical">{attention.length} open</Chip>
              ) : null
            }
            aside={
              <HeaderLink href="/collections/pending-approval">
                Review all
              </HeaderLink>
            }
          />
          {view.attention === null ? (
            <FormMessage tone="critical">
              Some checks couldn’t run just now, so this list may be incomplete.
            </FormMessage>
          ) : null}
          <ListCard
            label="Needs attention"
            rows={attention}
            empty="Nothing needs attention: no disputes, missed customers, waiting corrections or unstaffed lines."
          />
        </section>
        <LineCards view={view} />
        {canOnboard(me.role) ? (
          <StickyAction align="end">
            <Link
              href="/customers/new"
              className="flex h-12 items-center gap-2 rounded-pill border border-accent-hover bg-accent px-4 text-label font-semibold text-accent-ink shadow-popover transition-colors hover:bg-accent-hover active:scale-95"
            >
              <UserPlus aria-hidden size={20} />
              New customer
            </Link>
          </StickyAction>
        ) : null}
      </>
    );
  }

  return (
    <>
      {header(view)}
      <AccountsAwaitingApproval />
      {view.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {view.day.kind === "SUNDAY"
            ? "Sunday: no collections are due."
            : `Holiday: ${view.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}

      <DayHero view={view} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ActionList
          title="Needs attention"
          rows={[
            ...pendingExpensesRow(pendingExpenses),
            ...attentionRows(view.attention ?? [], view.businessDate),
          ]}
          incomplete={view.attention === null}
          empty="Nothing needs attention: no disputes, missed customers, waiting corrections or unstaffed lines."
        />
        <QuickActions
          pending={view.pendingApprovals?.total ?? null}
          books={books}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LinesToday view={view} />
        <TrendCard trend={trend} scope="every line" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SectorsCard sectors={view.sectors} date={view.businessDate} />
        {books ? <BooksTodayCard date={view.businessDate} /> : null}
        <PeopleCard view={view} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ the hero

/** The day at a glance: collected, lines closed, pending, extra, corrections. */
function DayHero({ view }: { view: Dashboard }) {
  const today = view.today;
  const approvals = view.pendingApprovals;
  const share = today ? perMille(today.collected, today.expected) : null;
  const closed = today ? today.linesToClose - today.linesNotClosed : null;
  return (
    <section
      aria-label="The day"
      className={cn(
        heroBandClass,
        "grid gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-center",
      )}
    >
      <div className="flex min-w-0 items-center gap-4 lg:border-r lg:border-accent-ink/15 lg:pr-5">
        <MiniRing surface="hero" share={share} label="Collected of expected" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-title" data-numeric>
            {today ? (
              share === null ? (
                "Nothing due"
              ) : (
                `${formatPerMille(share)} collected`
              )
            ) : (
              <Unknown />
            )}
          </span>
          <span className="text-caption opacity-80" data-numeric>
            {today
              ? `${formatCurrency(today.collected)} of ${formatCurrency(today.expected)} expected`
              : UNAVAILABLE}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:divide-x sm:divide-accent-ink/15">
        <HeroStat
          label="Lines closed"
          value={
            today && closed !== null
              ? `${closed} of ${today.linesToClose}`
              : null
          }
          caption={
            today
              ? today.linesNotClosed === 0
                ? "every line closed"
                : `${today.linesNotClosed} still open`
              : "lines collecting"
          }
        />
        <HeroStat
          label="Pending"
          value={today ? <Compact amount={today.pending} /> : null}
          caption={
            today ? `${today.lowCount} paid less than due` : "short of expected"
          }
        />
        <HeroStat
          label="Extra"
          value={today ? <Compact amount={today.extra} /> : null}
          caption={today ? `${today.extraCount} paid more` : "over expected"}
        />
        <HeroStat
          label="Corrections"
          value={approvals ? approvals.total : null}
          caption={
            approvals
              ? approvals.total === 0
                ? "none waiting"
                : `${approvals.awaitingYou} for you`
              : "waiting for approval"
          }
        />
      </dl>
    </section>
  );
}

// ------------------------------------------------------------- quick actions

function QuickActions({
  pending,
  books,
}: {
  pending: number | null;
  books: boolean;
}) {
  const me = useSignedIn();
  const tiles: {
    href: string;
    icon: Icon;
    tone: KpiTone;
    title: string;
    caption: string;
    badge?: ReactNode;
  }[] = [
    ...(canOnboard(me.role)
      ? [
          {
            href: "/customers/new",
            icon: UserPlus,
            tone: "accent" as const,
            title: "Add customer",
            caption: "Onboard to a line",
          },
          {
            href: "/accounts/new",
            icon: Wallet,
            tone: "accent" as const,
            title: "New account",
            caption: "Open and pay out a loan",
          },
        ]
      : []),
    {
      href: "/collections/pending-approval",
      icon: ArrowsLeftRight,
      tone: "warning",
      title: "Approve corrections",
      caption: "Waiting for a decision",
      badge: pending !== null && pending > 0 ? pending : undefined,
    },
    ...(books
      ? [
          {
            href: "/books/expenses?action=record",
            icon: Receipt,
            tone: "info" as const,
            title: "Record expense",
            caption: "Rent, salary, bills",
          },
        ]
      : []),
  ];
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header title="Quick actions" />
      <Card.Body className="pt-2">
        <nav aria-label="Quick actions">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tiles.map((tile) => (
              <li key={tile.href}>
                <Link
                  href={tile.href}
                  className="group flex h-full flex-col gap-2 rounded-surface border border-border p-3 transition-colors hover:border-accent hover:bg-accent-subtle"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-8 items-center justify-center rounded-control",
                        KPI_ICON[tile.tone],
                      )}
                    >
                      <tile.icon size={16} weight="regular" />
                    </span>
                    {tile.badge === undefined ? (
                      <CaretRight
                        aria-hidden
                        size={14}
                        className="text-ink-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      />
                    ) : (
                      <span
                        className="rounded-pill border border-warning-border bg-warning-subtle px-2 py-0.5 text-2xs font-semibold text-warning"
                        data-numeric
                      >
                        {tile.badge} waiting
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-label text-ink">{tile.title}</span>
                    <span className="text-caption text-ink-muted">
                      {tile.caption}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Card.Body>
    </Card.Root>
  );
}

// ---------------------------------------------------------------- the lines

/** BR-16 per line: expected not collected, never below zero. */
function linePending(line: LineToday): string {
  const gap = subtractMoney(line.expected, line.collected);
  return isNegativeMoney(gap) ? "0.00" : gap;
}

function LinesToday({ view }: { view: Dashboard }) {
  const lines = view.lines;
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Lines today"
        actions={
          <Link href="/lines" className={arrowLinkClass}>
            All lines
            <ArrowRight aria-hidden size={14} />
          </Link>
        }
      />
      <Card.Body className="pt-2">
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
                cell: (line) => (
                  <span className="flex flex-col">
                    {line.seniorName ?? (
                      <Link
                        href={`/lines/${line.lineId}`}
                        className="text-warning underline-offset-4 hover:underline"
                      >
                        No Senior
                      </Link>
                    )}
                    <span
                      className={cn(
                        "text-caption",
                        line.juniorCount === 0
                          ? "text-warning"
                          : "text-ink-muted",
                      )}
                      data-numeric
                    >
                      {line.juniorCount}{" "}
                      {line.juniorCount === 1 ? "Junior" : "Juniors"}
                    </span>
                  </span>
                ),
              }),
              moneyColumn<LineToday>({
                id: "collected",
                header: "Collected / expected",
                amount: (line) => line.collected,
                render: (line) => <LineProgress line={line} />,
                card: "headline",
              }),
              moneyColumn<LineToday>({
                id: "pending",
                header: "Pending",
                amount: linePending,
                render: (line) => (
                  <span
                    className={cn(
                      !isZeroMoney(linePending(line)) && "text-warning",
                    )}
                    data-numeric
                  >
                    <Money amount={linePending(line)} />
                  </span>
                ),
              }),
              displayColumn<LineToday>({
                id: "status",
                header: "Day",
                align: "end",
                card: "status",
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
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The Admin home's summary card: a ring for collected of expected, the
 * amount, and the date (which opens the date picker), then lines closed,
 * pending, extra and corrections across the foot.
 */
function DaySummary({
  view,
  shown,
  today,
  onDate,
}: {
  view: Dashboard;
  shown: string;
  today: string;
  onDate: (date: string) => void;
}) {
  const day = view.today;
  const approvals = view.pendingApprovals;
  const share = day ? perMille(day.collected, day.expected) : null;
  return (
    <SummaryCard label="The day">
      <div className="flex items-center gap-4">
        <SummaryRing
          size="lg"
          tone="positive"
          share={share}
          label="Collected of expected"
          text={share === null ? "—" : `${Math.floor(share / 10)}%`}
          caption="Collected"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-2xs font-medium tracking-wider uppercase opacity-80">
            Total collection
          </span>
          <span
            className="text-display leading-tight font-semibold"
            data-numeric
          >
            {day ? rupees(day.collected) : <HeroUnknown />}{" "}
            <span className="text-body font-normal opacity-90">collected</span>
          </span>
          <span className="truncate text-caption opacity-80" data-numeric>
            {day ? `of ${rupees(day.expected)} expected · ` : ""}
            <DateTap
              shown={shown}
              today={today}
              onDate={onDate}
              className="font-medium underline decoration-accent-ink/40 underline-offset-2"
            >
              {shortDate(shown)}
            </DateTap>
          </span>
        </div>
      </div>
      <SummaryStats
        align="center"
        items={[
          {
            label: "Lines closed",
            value: day ? (
              `${day.linesToClose - day.linesNotClosed}/${day.linesToClose}`
            ) : (
              <HeroUnknown />
            ),
          },
          {
            label: "Pending",
            value: day ? rupees(day.pending) : <HeroUnknown />,
            tone: day && !isZeroMoney(day.pending) ? "warning" : undefined,
          },
          {
            label: "Extra",
            value: day ? rupees(day.extra) : <HeroUnknown />,
            tone: "positive",
          },
          {
            label: "Corrections",
            value: approvals ? approvals.total : <HeroUnknown />,
          },
        ]}
      />
    </SummaryCard>
  );
}

const LINE_CHIP = {
  OPEN: { tone: "accent", label: "Open" },
  REOPENED: { tone: "critical", label: "Reopened" },
  CLOSED: { tone: "warning", label: "Closed" },
  TALLIED: { tone: "positive", label: "Tallied" },
} as const;

/** The phone home's lines (Stitch "Rasi Admin Home"): one card per line. */
function LineCards({ view }: { view: Dashboard }) {
  const lines = view.lines;
  return (
    <section aria-labelledby="lines-today" className="flex flex-col gap-2">
      <SectionHeader
        id="lines-today"
        variant="heading"
        title="Lines today"
        chip={
          lines ? (
            <span className="text-2xs font-medium text-ink-muted">
              {lines.filter((line) => line.isActive).length} active lines
            </span>
          ) : null
        }
        aside={<HeaderLink href="/lines">See all</HeaderLink>}
      />
      {lines === null ? (
        <FormMessage tone="critical">
          The lines couldn’t be read just now, so their figures are not shown.
        </FormMessage>
      ) : (
        <ul aria-label="Lines today" className="flex flex-col gap-2.5">
          {lines.map((line) => {
            const share = perMille(line.collected, line.expected);
            const pending = linePending(line);
            const chip =
              line.day.kind === "WORKING"
                ? LINE_CHIP[line.status]
                : { tone: "neutral" as const, label: "Not collecting" };
            return (
              <li key={line.lineId}>
                <Link
                  href={`/lines/${line.lineId}/day-closes/${view.businessDate}`}
                  className="flex flex-col gap-2 rounded-overlay border border-border bg-surface-raised p-3.5 shadow-raised transition-colors hover:border-border-strong"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-label font-semibold text-ink">
                          {line.name}
                        </span>
                        <CodeChip>{line.code}</CodeChip>
                      </span>
                      <span
                        className={cn(
                          "text-caption font-medium",
                          line.seniorName && line.juniorCount > 0
                            ? "text-ink-muted"
                            : "text-warning",
                        )}
                      >
                        {line.seniorName ?? "No Senior"} · {line.juniorCount}{" "}
                        {line.juniorCount === 1 ? "Junior" : "Juniors"}
                      </span>
                    </span>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </span>
                  {share === null ? null : (
                    <Bar
                      share={share}
                      label={`${line.name} collected of expected`}
                      tone={
                        line.status === "TALLIED"
                          ? "positive"
                          : line.status === "CLOSED"
                            ? "neutral"
                            : "accent"
                      }
                    />
                  )}
                  <span className="flex items-center justify-between gap-3 text-caption">
                    <span className="font-semibold text-ink" data-numeric>
                      {rupees(line.collected)}{" "}
                      <span className="font-normal text-ink-subtle">
                        / {rupees(line.expected)}
                      </span>
                    </span>
                    {!isZeroMoney(pending) ? (
                      <Chip tone="warning">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-pill bg-warning"
                        />
                        {rupees(pending)} pending
                      </Chip>
                    ) : line.status === "CLOSED" ||
                      line.status === "TALLIED" ? (
                      <span className="text-2xs font-semibold text-positive">
                        All collected
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

// ---------------------------------------------- sectors, books and people

function SectorsCard({
  sectors,
  date,
}: {
  sectors: SectorToday[] | null;
  date: string;
}) {
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Sectors"
        actions={<CompareSectorsLink date={date} />}
      />
      <Card.Body className="pt-2">
        {sectors === null ? (
          <FormMessage tone="critical">
            The sector breakdown couldn’t be worked out just now.
          </FormMessage>
        ) : sectors.length === 0 ? (
          <p className="text-body text-ink-muted">No sector has lines yet.</p>
        ) : (
          <ul aria-label="Sectors today" className="flex flex-col gap-2">
            {sectors.map((sector) => {
              const share = perMille(sector.collected, sector.expected);
              return (
                <li key={sector.sectorId}>
                  <Link
                    href={`/sectors/${sector.sectorId}`}
                    className="flex flex-col gap-1.5 rounded-surface border border-border p-3 transition-colors hover:border-accent"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-label text-ink">
                        {sector.name}
                      </span>
                      <span
                        className="text-caption text-ink-muted"
                        data-numeric
                      >
                        {formatCurrency(sector.collected)} of{" "}
                        {formatCurrency(sector.expected)}
                      </span>
                    </span>
                    {share === null ? null : (
                      <Meter
                        share={share}
                        label={`${sector.name} collected of expected`}
                      />
                    )}
                    <span className="text-caption text-ink-muted" data-numeric>
                      {sector.lineCount}{" "}
                      {sector.lineCount === 1 ? "line" : "lines"} ·{" "}
                      {sector.activeAccounts} active accounts
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The ledger on the date (ADR-0018), for an Admin who keeps the books: cash
 * and bank, cash still with collection staff, and the month's profit and
 * expenses — the balance sheet's and the P&L's own figures, so this card and
 * Books never disagree. Each statement is read on its own.
 */
function BooksTodayCard({ date }: { date: string }) {
  const sheet = useApiQuery(statementsContract.getBalanceSheet, {
    query: { date },
  });
  const pnl = useApiQuery(statementsContract.getProfitAndLoss, {
    query: { to: date },
  });
  if (sheet.status === "not-permitted" || pnl.status === "not-permitted") {
    return null;
  }
  const position = sheet.status === "ready" ? sheet.data : null;
  const month = pnl.status === "ready" ? pnl.data : null;
  const cell = (
    label: string,
    value: ReactNode,
    caption: ReactNode,
    tone: "neutral" | "positive" | "critical" = "neutral",
  ) => (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-surface border border-border p-3">
      <dt className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "text-heading",
          tone === "positive" && "text-positive",
          tone === "critical" && "text-critical",
          tone === "neutral" && "text-ink",
        )}
        data-numeric
      >
        {value}
      </dd>
      <dd className="text-caption text-ink-muted" data-numeric>
        {caption}
      </dd>
    </div>
  );
  const loading = sheet.status === "loading" || pnl.status === "loading";
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Ledger today"
        actions={
          position ? (
            <span
              className={cn(
                "rounded-control px-2 py-0.5 text-2xs font-semibold",
                position.balanced
                  ? "bg-positive-subtle text-positive"
                  : "bg-critical-subtle text-critical",
              )}
            >
              {position.balanced ? "Balanced" : "Doesn’t balance"}
            </span>
          ) : null
        }
      />
      <Card.Body className="pt-2">
        {loading ? <Skeleton className="h-32 w-full rounded-control" /> : null}
        {sheet.status === "error" ? (
          <LoadFailed message={sheet.message} onRetry={sheet.reload} />
        ) : null}
        {pnl.status === "error" ? (
          <LoadFailed message={pnl.message} onRetry={pnl.reload} />
        ) : null}
        {loading ? null : (
          <dl className="grid grid-cols-2 gap-2">
            {cell(
              "Cash & bank",
              position ? (
                <Compact
                  amount={sumMoney([
                    position.assets.officeCash,
                    ...position.assets.banks.map((bank) => bank.balance),
                  ])}
                />
              ) : (
                <Unknown />
              ),
              position ? "office and banks" : UNAVAILABLE,
            )}
            {cell(
              "With staff",
              position ? (
                <Compact
                  amount={sumMoney(
                    position.assets.cashWithStaff.map(
                      (person) => person.balance,
                    ),
                  )}
                />
              ) : (
                <Unknown />
              ),
              position ? "collected, not handed over" : UNAVAILABLE,
            )}
            {cell(
              month && isNegativeMoney(month.netProfit)
                ? "Loss this month"
                : "Profit this month",
              month ? <Compact amount={month.netProfit} /> : <Unknown />,
              month
                ? `since ${formatBusinessDate(month.from, "day-month")}`
                : UNAVAILABLE,
              month && isNegativeMoney(month.netProfit)
                ? "critical"
                : "positive",
            )}
            {cell(
              "Expenses this month",
              month ? <Compact amount={month.expenses.total} /> : <Unknown />,
              month ? "rent, salaries, field" : UNAVAILABLE,
            )}
          </dl>
        )}
        <Link href="/books" className={arrowLinkClass}>
          Open ledger
          <ArrowRight aria-hidden size={14} />
        </Link>
      </Card.Body>
    </Card.Root>
  );
}

function PeopleCard({ view }: { view: Dashboard }) {
  const { customers, accounts, investment } = view;
  const rows: [string, ReactNode][] = [
    ["New customers today", customers ? customers.new : <Unknown />],
    ["Active customers", customers ? customers.active : <Unknown />],
    [
      "Active accounts",
      accounts ? `${accounts.active} of ${accounts.total}` : <Unknown />,
    ],
    ["Completed accounts", accounts ? accounts.completed : <Unknown />],
    [
      "Invested, all time",
      investment ? formatCurrency(investment.invested) : <Unknown />,
    ],
    [
      "Profit agreed, all time",
      investment ? formatCurrency(investment.profit) : <Unknown />,
    ],
  ];
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Customers & accounts"
        actions={
          <Link href="/customers" className={arrowLinkClass}>
            Customers
            <ArrowRight aria-hidden size={14} />
          </Link>
        }
      />
      <Card.Body className="pt-2">
        <dl className="flex flex-col divide-y divide-border">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <dt className="text-body text-ink-muted">{label}</dt>
              <dd className="text-label text-ink" data-numeric>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card.Body>
    </Card.Root>
  );
}
