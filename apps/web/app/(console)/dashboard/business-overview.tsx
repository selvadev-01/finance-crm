"use client";

import {
  ArrowRight,
  CheckCircle,
  HandCoins,
  HourglassMedium,
  Receipt,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  type BalanceSheet,
  booksMoneyContract,
  type BusinessOverview as Overview,
  dashboardContract,
  exportContract,
  type OperationsDashboard,
  type ProfitAndLoss,
  reportContract,
  type SectorOverview,
  statementsContract,
  type TrendPoint,
} from "@repo/contracts";
import {
  addCalendarDays,
  dayOfWeek,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
} from "@repo/domain";
import {
  arrowLinkClass,
  buttonClass,
  Card,
  cn,
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
import type { ReactNode } from "react";

import { ExportMenu } from "../../../components/export-menu";
import { LoadFailed } from "../../../components/query-state";
import { StatusBadge } from "../../../components/status-badge";
import {
  changePerMille,
  formatCompactCurrency,
  formatPerMille,
  isNegativeMoney,
  isZeroMoney,
  perMille,
  subtractMoney,
  sumMoney,
} from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";
import { type ConsoleRole, homeMenu } from "../../../lib/home-menu";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { signedAmount } from "../books/visuals";
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
  HeroStat,
  HeroUnknown,
  type Icon,
  KpiCard,
  MiniRing,
  pendingExpensesRow,
  Sparkline,
} from "./dashboard-visuals";
import {
  Bar,
  Chip,
  FigureRow,
  greeting,
  GreetingRow,
  HeaderLink,
  HomeCard,
  homeRows,
  ListCard,
  MenuGrid,
  rupees,
  SectionHeader,
  SummaryCard,
  SummaryStats,
  usePhoneLayout,
} from "./phone-home";
import { TrendCard, useTrend } from "./trend-card";

/** An empty date is today; it is left out of the URL. */
const DEFAULTS = { date: "" };

/**
 * S-07 · Business overview (US-080; Stitch "Super Admin Dashboard
 * (Compact)", 2026-10-02): the owner's one screen, money first. The hero
 * and the donut are the ledger's balance sheet on the date shown, the P&L
 * its month up to that date — the same readers as Books, so the two never
 * disagree — then the day's collections, the sectors, and what waits on the
 * owner. §17's structural and all-time figures close the page in one strip.
 *
 * Every source is read on its own: one that fails shows "—" or its own
 * retry and leaves the rest standing, never a zero (S-07).
 */
export function BusinessOverview({
  initial,
}: {
  initial: Partial<typeof DEFAULTS>;
}) {
  const me = useSignedIn();
  const phone = usePhoneLayout();
  const { filters, setFilter } = useListState(DEFAULTS, initial);
  const today = toBusinessDate(new Date());
  const shown = filters.date || today;
  const future = shown > today;
  const dated = future ? null : { query: { date: shown } };

  const query = useApiQuery(
    dashboardContract.getOverview,
    future ? null : { query: filters.date ? { date: filters.date } : {} },
  );
  const trend = useTrend(future ? null : shown);
  const sheet = useApiQuery(statementsContract.getBalanceSheet, dated);
  // Where the month started: the balance sheet on the day before its first.
  const opening = useApiQuery(
    statementsContract.getBalanceSheet,
    future
      ? null
      : {
          query: {
            date: addCalendarDays(startOfMonth(parseCalendarDate(shown)), -1),
          },
        },
  );
  const pnl = useApiQuery(
    statementsContract.getProfitAndLoss,
    future ? null : { query: { to: shown } },
  );
  const books = useApiQuery(booksMoneyContract.getBooksOverview, dated);
  const operations = useApiQuery(dashboardContract.getOperations, dated);
  // The overdue report is a position now, not a dated figure (US-087).
  const overdue = useApiQuery(
    reportContract.getOverdue,
    future ? null : { query: { limit: 1 } },
  );

  const header = (view: Overview | null) => (
    <PageHeader
      title={`Hello, ${me.name.split(" ")[0]}`}
      meta={
        <>
          <span>
            Your business on {WEEKDAYS[dayOfWeek(parseCalendarDate(shown))]},{" "}
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

  const position = sheet.status === "ready" ? sheet.data : null;
  const month = pnl.status === "ready" ? pnl.data : null;
  const pendingExpenses =
    books.status === "ready" ? books.data.month.pendingFieldExpenses : null;

  if (phone) {
    // Stitch "S-00 Super Admin Home": greeting, total funds, today's
    // collections, what needs the owner, then the menu — nothing else.
    const attention = homeRows([
      ...pendingExpensesRow(pendingExpenses),
      ...attentionRows(
        operations.status === "ready" ? (operations.data.attention ?? []) : [],
        view.businessDate,
      ),
    ]);
    const menu = homeMenu(me.role as ConsoleRole, { line: null });
    return (
      <>
        <GreetingRow
          title={`${greeting(new Date())}, ${me.name.split(" ")[0]}`}
          shown={shown}
          today={today}
          onDate={(value) => setFilter("date", value === today ? "" : value)}
        />
        {view.day.kind !== "WORKING" ? (
          <FormMessage tone="info">
            {view.day.kind === "SUNDAY"
              ? "Sunday: no collections are due."
              : `Holiday: ${view.day.name}. No collections are due.`}
          </FormMessage>
        ) : null}
        {sheet.status === "error" ? (
          <LoadFailed message={sheet.message} onRetry={sheet.reload} />
        ) : (
          <FundsSummary
            position={position}
            opening={opening.status === "ready" ? opening.data : null}
            month={month}
          />
        )}
        <TodayStrip
          view={view}
          overdue={
            overdue.status === "ready" && overdue.data.summary
              ? overdue.data.summary.outstanding
              : null
          }
        />
        <section aria-labelledby="needs-you" className="flex flex-col gap-2">
          <SectionHeader
            id="needs-you"
            variant="overline"
            title="Action required"
            dot={attention.length > 0}
            aside={
              <HeaderLink href="/collections/pending-approval">
                Review queue
              </HeaderLink>
            }
          />
          {operations.status === "error" ? (
            <FormMessage tone="critical">
              Some checks couldn’t run just now, so this list may be incomplete.
            </FormMessage>
          ) : null}
          <ListCard
            label="Pending actions"
            rows={attention}
            empty="Nothing is waiting on you."
          />
        </section>
        <section aria-labelledby="home-menu" className="flex flex-col gap-2">
          <SectionHeader
            id="home-menu"
            variant="overline"
            title="Menu"
            aside={
              <span className="text-2xs text-ink-muted">
                {menu.length} operational tools
              </span>
            }
          />
          <MenuGrid
            variant="card"
            items={menu}
            counts={{
              approvals:
                operations.status === "ready"
                  ? (operations.data.pendingApprovals?.total ?? null)
                  : null,
              expenses: pendingExpenses,
            }}
          />
        </section>
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

      {sheet.status === "error" ? (
        <LoadFailed message={sheet.message} onRetry={sheet.reload} />
      ) : (
        <HeroBand
          view={view}
          position={position}
          opening={opening.status === "ready" ? opening.data : null}
          month={month}
        />
      )}

      <section
        aria-label="Today and this month"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <CollectedCard view={view} points={trendPoints(trend)} />
        <KpiCard
          label="Pending today"
          icon={HourglassMedium}
          tone="warning"
          value={view.today ? formatCurrency(view.today.pending) : <Unknown />}
          hint={
            view.today
              ? `${view.today.lowCount} paid less than due · short of expected, line by line`
              : UNAVAILABLE
          }
          href={`/collections?from=${view.businessDate}&to=${view.businessDate}`}
        />
        <KpiCard
          label="Overdue loans"
          icon={Warning}
          tone="critical"
          value={
            overdue.status === "ready" && overdue.data.summary ? (
              formatCurrency(overdue.data.summary.outstanding)
            ) : (
              <Unknown />
            )
          }
          hint={
            overdue.status === "ready" && overdue.data.summary
              ? `${overdue.data.summary.accounts} ${overdue.data.summary.accounts === 1 ? "account" : "accounts"} past their end date · ${formatCurrency(overdue.data.summary.arrears)} behind`
              : overdue.status === "loading"
                ? "…"
                : UNAVAILABLE
          }
          href="/reports/overdue"
        />
        <KpiCard
          label="Expenses this month"
          icon={Receipt}
          tone="info"
          value={month ? formatCurrency(month.expenses.total) : <Unknown />}
          hint={
            books.status === "ready"
              ? books.data.month.pendingFieldExpenses === 0
                ? "no field expense waiting"
                : `${books.data.month.pendingFieldExpenses} field ${books.data.month.pendingFieldExpenses === 1 ? "expense" : "expenses"} waiting approval`
              : month
                ? `since ${formatBusinessDate(month.from)}`
                : UNAVAILABLE
          }
          href="/books/expenses"
        />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <MoneyDonut sheet={sheet} />
        <TrendCard trend={trend} scope="every line" />
        <MonthCard pnl={pnl} date={shown} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectorsCard view={view} />
        <AttentionCard
          date={view.businessDate}
          operations={operations.status === "ready" ? operations.data : null}
          operationsFailed={operations.status === "error"}
          pendingExpenses={
            books.status === "ready"
              ? books.data.month.pendingFieldExpenses
              : null
          }
        />
      </div>

      <BusinessStrip view={view} />
    </>
  );
}

/**
 * The phone home's line under the hero (Stitch S-00): today's collections as
 * one bar, then pending, overdue and the sectors' tally.
 */
function TodayStrip({
  view,
  overdue,
}: {
  view: Overview;
  overdue: string | null;
}) {
  const today = view.today;
  const share = today ? perMille(today.collected, today.expected) : null;
  return (
    <HomeCard aria-label="Today’s collections">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-caption font-semibold text-ink">
          Today’s collections
        </h2>
        {share === null ? null : (
          <Chip tone="positive">{formatPerMille(share)} collected</Chip>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-body font-semibold text-ink" data-numeric>
            {today ? (
              <>
                {rupees(today.collected)}{" "}
                <span className="text-caption font-normal text-ink-muted">
                  of {rupees(today.expected)}
                </span>
              </>
            ) : (
              <Unknown />
            )}
          </span>
          {share === null ? null : (
            <span
              className="text-caption font-semibold text-accent"
              data-numeric
            >
              {formatPerMille(share)}
            </span>
          )}
        </span>
        {share === null ? null : (
          <Bar share={share} label="Collected of expected" size="md" />
        )}
      </div>
      <FigureRow
        items={[
          {
            label: "Pending",
            value: today ? <Compact amount={today.pending} /> : <Unknown />,
            tone: today && !isZeroMoney(today.pending) ? "warning" : undefined,
          },
          {
            label: "Overdue",
            value:
              overdue === null ? <Unknown /> : <Compact amount={overdue} />,
            tone:
              overdue !== null && !isZeroMoney(overdue)
                ? "critical"
                : undefined,
          },
          {
            label: "Sectors tallied",
            value: view.tally ? (
              `${view.tally.tallied} of ${view.tally.collecting}`
            ) : (
              <Unknown />
            ),
          },
        ]}
      />
    </HomeCard>
  );
}

/**
 * S-00's summary: total funds (the balance sheet's equity) with its change
 * since the month opened, then what customers owe, what is in hand, and the
 * month's profit.
 */
function FundsSummary({
  position,
  opening,
  month,
}: {
  position: BalanceSheet | null;
  opening: BalanceSheet | null;
  month: ProfitAndLoss | null;
}) {
  const change =
    position && opening
      ? changePerMille(position.equity.total, opening.equity.total)
      : null;
  const inHand = position
    ? sumMoney([
        position.assets.officeCash,
        ...position.assets.banks.map((bank) => bank.balance),
        ...position.assets.cashWithStaff.map((person) => person.balance),
      ])
    : null;
  return (
    <SummaryCard label="Fund position">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold tracking-wider uppercase opacity-80">
          Total funds
        </span>
        {change === null ? null : (
          <span
            className="inline-flex items-center gap-1 rounded-pill border border-positive-bright/30 bg-positive-bright/20 px-2 py-0.5 text-2xs font-semibold text-positive-subtle"
            data-numeric
          >
            <span aria-hidden>{change < 0 ? "▼" : "▲"}</span>
            <span className="sr-only">{change < 0 ? "down" : "up"}</span>
            {formatPerMille(Math.abs(change))} this month
          </span>
        )}
      </div>
      <span className="text-display leading-none font-semibold" data-numeric>
        {position ? (
          <Compact amount={position.equity.total} />
        ) : (
          <HeroUnknown />
        )}
      </span>
      <SummaryStats
        items={[
          {
            label: "To collect",
            value: position ? (
              <Compact amount={position.assets.loansReceivable} />
            ) : (
              <HeroUnknown />
            ),
          },
          {
            label: "Cash & bank",
            value:
              inHand === null ? <HeroUnknown /> : <Compact amount={inHand} />,
          },
          {
            label: month
              ? `Profit (${MONTH_SHORT[Number(month.to.slice(5, 7)) - 1]})`
              : "Profit",
            value: month ? (
              <Compact amount={month.netProfit} />
            ) : (
              <HeroUnknown />
            ),
            tone:
              month && !isNegativeMoney(month.netProfit)
                ? "positive"
                : undefined,
          },
        ]}
      />
    </SummaryCard>
  );
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ------------------------------------------------------------------- the hero

/**
 * The owner's money on the date, from the balance sheet: what the business
 * is worth to them (capital and kept profit, less drawings), what customers
 * still owe, what is in hand, and the month's profit so far.
 */
function HeroBand({
  view,
  position,
  opening,
  month,
  compact = false,
}: {
  view: Overview;
  position: BalanceSheet | null;
  opening: BalanceSheet | null;
  month: ProfitAndLoss | null;
  /** The phone home: three figures in a row, without their captions. */
  compact?: boolean;
}) {
  const change =
    position && opening
      ? changePerMille(position.equity.total, opening.equity.total)
      : null;
  const inHand = position
    ? sumMoney([
        position.assets.officeCash,
        ...position.assets.banks.map((bank) => bank.balance),
        ...position.assets.cashWithStaff.map((person) => person.balance),
      ])
    : null;
  return (
    <section
      aria-label="Fund position"
      className={cn(
        heroBandClass,
        "grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5 lg:border-r lg:border-accent-ink/15 lg:pr-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs font-medium tracking-[0.08em] uppercase opacity-80">
            Total funds
          </span>
          {change === null ? null : <ChangeChip perMille={change} />}
        </div>
        <span className="text-display" data-numeric>
          {position ? (
            <Compact amount={position.equity.total} />
          ) : (
            <HeroUnknown />
          )}
        </span>
        <span className="text-caption opacity-80" data-numeric>
          {position
            ? `Capital ${formatCompactCurrency(position.equity.capital)} + profit kept ${formatCompactCurrency(position.equity.retainedProfit)} − drawings ${formatCompactCurrency(position.equity.drawings)}`
            : "From the balance sheet"}
        </span>
      </div>
      <dl
        className={cn(
          "grid gap-4",
          compact
            ? "grid-cols-3 divide-x divide-accent-ink/15 border-t border-accent-ink/15 pt-3 [&>div]:px-2 [&>div]:first:pl-0"
            : "grid-cols-1 sm:grid-cols-3 sm:divide-x sm:divide-accent-ink/15",
        )}
      >
        <HeroStat
          label="To collect"
          value={
            position ? (
              <Compact amount={position.assets.loansReceivable} />
            ) : null
          }
          caption={
            compact
              ? undefined
              : view.accounts && view.structure
                ? `${view.accounts.active} active loans · ${view.structure.lines} lines`
                : "owed by customers"
          }
        />
        <HeroStat
          label="Cash & bank"
          value={inHand === null ? null : <Compact amount={inHand} />}
          caption={
            compact
              ? undefined
              : position
                ? `office ${formatCompactCurrency(position.assets.officeCash)} · with staff ${formatCompactCurrency(sumMoney(position.assets.cashWithStaff.map((person) => person.balance)))}`
                : "office, banks and staff"
          }
        />
        <HeroStat
          label={
            month && isNegativeMoney(month.netProfit)
              ? "Loss this month"
              : "Profit this month"
          }
          value={month ? <Compact amount={month.netProfit} /> : null}
          caption={
            compact
              ? undefined
              : month
                ? `earned ${formatCompactCurrency(month.income.total)} − spent ${formatCompactCurrency(month.expenses.total)}`
                : "from the profit and loss"
          }
        />
      </dl>
    </section>
  );
}

/** "▲ 2.1% this month" against the balance sheet at the month's opening. */
function ChangeChip({ perMille: change }: { perMille: number }) {
  const falling = change < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-semibold",
        falling
          ? "bg-critical-subtle text-critical"
          : "bg-positive-subtle text-positive",
      )}
      data-numeric
    >
      <span aria-hidden>{falling ? "▼" : "▲"}</span>
      <span className="sr-only">{falling ? "down" : "up"}</span>
      {formatPerMille(Math.abs(change))} this month
    </span>
  );
}

// --------------------------------------------------------------- the KPI row

function trendPoints(trend: ReturnType<typeof useTrend>): TrendPoint[] | null {
  return trend.status === "ready" ? trend.data.points : null;
}

function CollectedCard({
  view,
  points,
}: {
  view: Overview;
  points: TrendPoint[] | null;
}) {
  const today = view.today;
  const share = today ? perMille(today.collected, today.expected) : null;
  return (
    <KpiCard
      label="Collected today"
      icon={HandCoins}
      tone="accent"
      value={today ? formatCurrency(today.collected) : <Unknown />}
      hint={
        today
          ? share === null
            ? "nothing was due"
            : `${formatPerMille(share)} of ${formatCurrency(today.expected)} due`
          : UNAVAILABLE
      }
      href={`/collections?from=${view.businessDate}&to=${view.businessDate}`}
      aside={points ? <Sparkline points={points} /> : null}
    />
  );
}

// ------------------------------------------------------------- money and P&L

const DONUT_PARTS = [
  { key: "lent", label: "Lent out", stroke: "stroke-accent", dot: "bg-accent" },
  { key: "bank", label: "Bank", stroke: "stroke-info", dot: "bg-info" },
  {
    key: "staff",
    label: "With staff",
    stroke: "stroke-warning-bright",
    dot: "bg-warning-bright",
  },
  {
    key: "office",
    label: "Office cash",
    stroke: "stroke-ink-subtle",
    dot: "bg-ink-subtle",
  },
] as const;

type SheetQuery = ReturnType<
  typeof useApiQuery<typeof statementsContract.getBalanceSheet>
>;

/**
 * Where the total funds are, from the balance sheet's asset side. Lent out is
 * the principal still with customers — the receivables less the profit not
 * yet earned in them — so the four parts add up to the total funds exactly
 * when the books balance.
 */
function MoneyDonut({ sheet }: { sheet: SheetQuery }) {
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Fund deployment"
        actions={
          sheet.status === "ready" ? (
            sheet.data.balanced ? (
              <span className="inline-flex items-center gap-1 rounded-control bg-positive-subtle px-2 py-0.5 text-2xs font-semibold text-positive">
                <CheckCircle aria-hidden size={12} weight="bold" />
                Books balance
              </span>
            ) : (
              <Link
                href="/reports/trial-balance"
                className="inline-flex items-center gap-1 rounded-control bg-critical-subtle px-2 py-0.5 text-2xs font-semibold text-critical"
              >
                <WarningCircle aria-hidden size={12} weight="bold" />
                Books don’t balance
              </Link>
            )
          ) : null
        }
      />
      <Card.Body className="pt-2">
        {sheet.status === "loading" ? (
          <Skeleton className="h-32 w-full rounded-control" />
        ) : null}
        {sheet.status === "error" ? (
          <LoadFailed message={sheet.message} onRetry={sheet.reload} />
        ) : null}
        {sheet.status === "not-found" || sheet.status === "not-permitted" ? (
          <p className="text-body text-ink-muted">
            The books aren’t available to you here.
          </p>
        ) : null}
        {sheet.status === "ready" ? <DonutBody sheet={sheet.data} /> : null}
      </Card.Body>
    </Card.Root>
  );
}

function DonutBody({ sheet }: { sheet: BalanceSheet }) {
  const amounts: Record<(typeof DONUT_PARTS)[number]["key"], string> = {
    lent: subtractMoney(
      sheet.assets.loansReceivable,
      sheet.assets.unearnedProfit,
    ),
    bank: sumMoney(sheet.assets.banks.map((bank) => bank.balance)),
    staff: sumMoney(sheet.assets.cashWithStaff.map((person) => person.balance)),
    office: sheet.assets.officeCash,
  };
  // A negative holding (office cash run below zero) has no slice to draw.
  const drawn = sumMoney(
    Object.values(amounts).filter((amount) => !isNegativeMoney(amount)),
  );
  const shares = DONUT_PARTS.map((part) => {
    const amount = amounts[part.key];
    const share = isNegativeMoney(amount) ? 0 : (perMille(amount, drawn) ?? 0);
    return { ...part, amount, share };
  });
  // Each slice starts where the ones before it end.
  const slices = shares.map((slice, index) => ({
    ...slice,
    start: shares
      .slice(0, index)
      .reduce((sum, before) => sum + before.share, 0),
  }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-5">
        <span className="relative grid size-28 shrink-0 place-items-center">
          <svg
            aria-hidden
            viewBox="0 0 48 48"
            className="absolute inset-0 -rotate-90"
          >
            <circle
              cx="24"
              cy="24"
              r="19"
              fill="none"
              strokeWidth="6"
              className="stroke-surface-sunken"
            />
            {slices.map((slice) =>
              slice.share === 0 ? null : (
                <circle
                  key={slice.key}
                  cx="24"
                  cy="24"
                  r="19"
                  fill="none"
                  strokeWidth="6"
                  pathLength={1000}
                  strokeDasharray={`${slice.share} 1000`}
                  strokeDashoffset={-slice.start}
                  className={slice.stroke}
                />
              ),
            )}
          </svg>
          <span className="flex flex-col items-center">
            <span className="text-label text-ink" data-numeric>
              <Compact amount={sheet.assets.total} />
            </span>
            <span className="text-2xs tracking-[0.08em] text-ink-muted uppercase">
              Assets
            </span>
          </span>
        </span>
        <ul
          aria-label="Fund deployment"
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          {slices.map((slice) => (
            <li
              key={slice.key}
              className="flex items-center justify-between gap-3 text-caption"
            >
              <span className="flex items-center gap-2 whitespace-nowrap text-ink-muted">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-pill", slice.dot)}
                />
                {slice.label}
                <span data-numeric>{formatPerMille(slice.share)}</span>
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-ink",
                  isNegativeMoney(slice.amount) && "text-critical",
                )}
                data-numeric
              >
                <Compact amount={slice.amount} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-caption text-ink-muted">
        <span>As of {formatBusinessDate(sheet.asOf)}</span>
        <Link href="/books/balance-sheet" className={arrowLinkClass}>
          Balance sheet
          <ArrowRight aria-hidden size={14} />
        </Link>
      </div>
    </div>
  );
}

type PnlQuery = ReturnType<
  typeof useApiQuery<typeof statementsContract.getProfitAndLoss>
>;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function MonthCard({ pnl, date }: { pnl: PnlQuery; date: string }) {
  const monthName = MONTHS[Number(date.slice(5, 7)) - 1];
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title={`Profit & loss · ${monthName}`}
        actions={
          <span className="text-caption text-ink-muted" data-numeric>
            to {formatBusinessDate(date, "day-month")}
          </span>
        }
      />
      <Card.Body className="pt-2">
        {pnl.status === "loading" ? (
          <Skeleton className="h-32 w-full rounded-control" />
        ) : null}
        {pnl.status === "error" ? (
          <LoadFailed message={pnl.message} onRetry={pnl.reload} />
        ) : null}
        {pnl.status === "not-found" || pnl.status === "not-permitted" ? (
          <p className="text-body text-ink-muted">
            The books aren’t available to you here.
          </p>
        ) : null}
        {pnl.status === "ready" ? <MonthBody pnl={pnl.data} /> : null}
      </Card.Body>
    </Card.Root>
  );
}

function MonthBody({ pnl }: { pnl: ProfitAndLoss }) {
  const larger =
    perMille(pnl.income.total, pnl.expenses.total) === null ||
    (perMille(pnl.income.total, pnl.expenses.total) ?? 0) >= 1000
      ? pnl.income.total
      : pnl.expenses.total;
  const loss = isNegativeMoney(pnl.netProfit);
  const margin = perMille(pnl.netProfit, pnl.income.total);
  const categories = pnl.expenses.categories.slice(0, 3);
  const rest = sumMoney(
    pnl.expenses.categories.slice(3).map((category) => category.amount),
  );
  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ["Profit earned", pnl.income.total, "bg-accent", "text-ink"],
          [
            "Expenses",
            pnl.expenses.total,
            "bg-critical-bright",
            "text-critical",
          ],
        ] as const
      ).map(([label, amount, fill, ink]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="flex justify-between text-caption">
            <span className="text-ink-muted">{label}</span>
            <span className={ink} data-numeric>
              {signedAmount(amount)}
            </span>
          </span>
          <span className="block h-2 overflow-hidden rounded-pill bg-surface-sunken">
            <span
              className={cn("block h-full rounded-pill", fill)}
              style={{
                width: `${Math.min(perMille(amount, larger) ?? 0, 1000) / 10}%`,
              }}
            />
          </span>
        </div>
      ))}
      {categories.length > 0 ? (
        <ul aria-label="Largest expenses" className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <li
              key={category.categoryId}
              className="rounded-control bg-surface-sunken px-2 py-0.5 text-2xs text-ink"
              data-numeric
            >
              {category.name} {formatCompactCurrency(category.amount)}
            </li>
          ))}
          {isZeroMoney(rest) ? null : (
            <li
              className="rounded-control bg-surface-sunken px-2 py-0.5 text-2xs text-ink"
              data-numeric
            >
              Other {formatCompactCurrency(rest)}
            </li>
          )}
        </ul>
      ) : null}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2",
          loss
            ? "border-critical-border bg-critical-subtle"
            : "border-positive-border bg-positive-subtle",
        )}
      >
        <span className="flex flex-col">
          <span
            className={cn(
              "text-2xs font-medium tracking-[0.08em] uppercase",
              loss ? "text-critical" : "text-positive",
            )}
          >
            {loss ? "Net loss" : "Net profit"}
          </span>
          <span
            className={cn(
              "text-heading",
              loss ? "text-critical" : "text-positive",
            )}
            data-numeric
          >
            {signedAmount(pnl.netProfit)}
          </span>
        </span>
        {margin === null || loss ? null : (
          <span
            className="rounded-control border border-positive-border bg-surface-raised px-2 py-0.5 text-caption text-positive"
            data-numeric
          >
            {formatPerMille(margin)} kept
          </span>
        )}
      </div>
      <Link href="/books/profit-and-loss" className={arrowLinkClass}>
        Profit and loss
        <ArrowRight aria-hidden size={14} />
      </Link>
    </div>
  );
}

// ------------------------------------------------------ sectors and attention

const SECTOR_RING = {
  TALLIED: "positive",
  CLOSED: "warning",
  OPEN: "accent",
  NO_COLLECTIONS: "accent",
} as const;

function SectorsCard({ view }: { view: Overview }) {
  const sectors = view.sectors;
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title="Sectors today"
        actions={
          <span className="flex flex-wrap gap-4">
            <CompareSectorsLink date={view.businessDate} />
          </span>
        }
      />
      <Card.Body className="pt-2">
        {sectors === null ? (
          <FormMessage tone="critical">
            The sectors couldn’t be worked out just now, so their figures are
            not shown.
          </FormMessage>
        ) : sectors.length === 0 ? (
          <p className="text-body text-ink-muted">No sector has lines yet.</p>
        ) : (
          <ul
            aria-label="Sectors today"
            className="grid grid-cols-1 gap-2.5 md:grid-cols-2"
          >
            {sectors.map((sector) => (
              <li key={sector.sectorId}>
                <SectorRow sector={sector} />
              </li>
            ))}
          </ul>
        )}
        {view.tally ? (
          <p className="border-t border-border pt-2 text-caption text-ink-muted">
            {view.tally.collecting === 0
              ? "No sector had collections due."
              : `${view.tally.tallied} of ${view.tally.collecting} sectors tallied · ${view.tally.withLow} with low collection · ${view.tally.withExtra} with extra`}
          </p>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

function SectorRow({ sector }: { sector: SectorOverview }) {
  const share = perMille(sector.collected, sector.expected);
  return (
    <Link
      href={`/sectors/${sector.sectorId}`}
      className="flex items-center justify-between gap-3 rounded-surface border border-border bg-surface-sunken/40 p-3 transition-colors hover:border-accent"
    >
      <span className="flex min-w-0 items-center gap-3">
        <MiniRing
          share={share}
          tone={SECTOR_RING[sector.tally]}
          label={`${sector.name} collected of expected`}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-heading text-ink" title={sector.code}>
            {sector.name}
          </span>
          <span className="text-caption text-ink-muted" data-numeric>
            {formatCurrency(sector.collected)} of{" "}
            {formatCurrency(sector.expected)}
          </span>
        </span>
      </span>
      {isZeroMoney(sector.shortfall) ? (
        <StatusBadge kind="sectorTally" value={sector.tally} shape="pill" />
      ) : (
        <span
          className="shrink-0 rounded-pill border border-warning-border bg-warning-subtle px-2 py-0.5 text-2xs font-semibold text-warning"
          data-numeric
        >
          Short {formatCompactCurrency(sector.shortfall)}
        </span>
      )}
    </Link>
  );
}

/**
 * What waits on the owner: field expenses to decide (Books), and the Admin
 * dashboard's own attention list — waiting corrections, days not closed,
 * disputed handovers, missed customers, unstaffed lines.
 */
function AttentionCard({
  date,
  operations,
  operationsFailed,
  pendingExpenses,
}: {
  date: string;
  operations: OperationsDashboard | null;
  operationsFailed: boolean;
  pendingExpenses: number | null;
}) {
  return (
    <ActionList
      title="Pending actions"
      rows={[
        ...pendingExpensesRow(pendingExpenses),
        ...attentionRows(operations?.attention ?? [], date),
      ]}
      incomplete={
        operationsFailed ||
        (operations !== null && operations.attention === null)
      }
      empty="Nothing is waiting on you."
    />
  );
}

// ------------------------------------------------------------ §17 in a strip

/**
 * §17's structural counts and all-time totals (US-080), kept on the page as
 * one line: the shape of the business, and every account ever disbursed.
 */
function BusinessStrip({ view }: { view: Overview }) {
  const { structure, accounts, totals } = view;
  const count = (value: number | undefined) =>
    value === undefined ? <Unknown /> : value;
  const money = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);
  const items: [string, ReactNode, string | null][] = [
    ["Sectors", count(structure?.sectors), "/sectors"],
    ["Lines", count(structure?.lines), "/lines"],
    ["Customers", count(structure?.customers), "/customers"],
    ["Active accounts", count(accounts?.active), null],
    ["Completed accounts", count(accounts?.completed), null],
    ["Lent all time", money(totals?.accountAmount), null],
    ["Invested", money(totals?.invested), null],
    ["Profit agreed", money(totals?.profit), null],
  ];
  return (
    <section
      aria-label="The business"
      className="rounded-tile border border-border bg-surface-raised px-4 py-3"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
        {items.map(([label, value, href]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="truncate text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
              {label}
            </dt>
            <dd className="truncate text-label text-ink" data-numeric>
              {href ? (
                <Link
                  href={href}
                  className="underline-offset-4 hover:underline focus-visible:underline"
                >
                  {value}
                </Link>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
