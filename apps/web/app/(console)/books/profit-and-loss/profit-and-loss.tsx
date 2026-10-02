"use client";

import { exportContract, statementsContract } from "@repo/contracts";
import {
  addCalendarDays,
  type CalendarDate,
  startOfMonth,
  toBusinessDate,
} from "@repo/domain";
import {
  AreaChart,
  cn,
  EmptyFrame,
  FilterBar,
  formatBusinessDate,
  formatCurrency,
  ListSkeleton,
  NotPermitted,
  PageHeader,
  Skeleton,
} from "@repo/ui";

import { ExportMenu } from "../../../../components/export-menu";
import { LoadFailed } from "../../../../components/query-state";
import { isNegativeMoney } from "../../../../lib/money";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import {
  RANGE_FILTERS,
  RangeFields,
  useStatementRange,
} from "../statement-parts";
import { BarRows, Note, signedAmount } from "../visuals";

const MONTH = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthName = (date: string) => MONTH.format(new Date(`${date}T00:00:00Z`));

/** The month before `date`'s month, by its first day. */
const previousMonth = (date: CalendarDate) =>
  startOfMonth(addCalendarDays(startOfMonth(date), -1));

/** The last day of `start`'s month, or today if that is earlier. */
function monthEnd(start: CalendarDate, today: CalendarDate): CalendarDate {
  const last = addCalendarDays(startOfMonth(addCalendarDays(start, 32)), -1);
  return last > today ? today : last;
}

/** Presets read like the owner asks: this month, last month, quarter, year. */
function presets(today: CalendarDate) {
  const thisMonth = startOfMonth(today);
  const lastMonth = previousMonth(today);
  const quarter = previousMonth(previousMonth(thisMonth));
  const year = `${today.slice(0, 4)}-01-01` as CalendarDate;
  return [
    { label: "This month", from: thisMonth, to: today },
    { label: "Last month", from: lastMonth, to: monthEnd(lastMonth, today) },
    { label: "Last 3 months", from: quarter, to: today },
    { label: "This year", from: year, to: today },
  ];
}

/**
 * Books · profit and loss (ADR-0018, US-105; Stitch B-06). Did the business
 * make money? The answer first, as a sum; then what was earned and what was
 * spent by category; then six months side by side. Lending is not on it — a
 * disbursement turns cash into a receivable — and nor is the principal inside
 * a collection.
 */
export function ProfitAndLossView({
  initial,
}: {
  initial: Partial<typeof RANGE_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const { filters, setFilter } = useListState(RANGE_FILTERS, initial);
  const { from, to, today } = useStatementRange(filters);
  const pnl = useApiQuery(
    statementsContract.getProfitAndLoss,
    allowed ? { query: { from, to } } : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The books are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  const choose = (range: { from: string; to: string }) => {
    setFilter("from", range.from);
    setFilter("to", range.to);
  };

  return (
    <>
      <PageHeader
        title="Profit & loss"
        description="Did the business make money? What it earned, less what it spent."
        actions={
          <ExportMenu
            route={exportContract.profitAndLoss}
            query={{ from, to }}
            disabled={pnl.status !== "ready"}
          />
        }
      />
      <FilterBar
        summary={`${formatBusinessDate(from)} – ${formatBusinessDate(to)}`}
        actions={
          <div
            role="group"
            aria-label="Period"
            className="flex flex-wrap gap-1 rounded-control bg-surface-sunken p-1"
          >
            {presets(today).map((preset) => {
              const current = preset.from === from && preset.to === to;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={current}
                  onClick={() => choose(preset)}
                  className={cn(
                    "rounded-control px-3 py-1.5 text-label transition-colors",
                    current
                      ? "bg-surface-raised text-ink shadow-raised"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        }
      >
        <RangeFields
          from={from}
          to={to}
          today={today}
          onChange={(key, value) => setFilter(key, value)}
        />
      </FilterBar>

      {pnl.status === "loading" ? <ListSkeleton columns={2} rows={6} /> : null}
      {pnl.status === "error" ? (
        <LoadFailed message={pnl.message} onRetry={pnl.reload} />
      ) : null}
      {pnl.status === "ready" ? (
        <>
          <ResultCard
            from={from}
            to={to}
            income={pnl.data.income.total}
            expenses={pnl.data.expenses.total}
            net={pnl.data.netProfit}
          />

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <section
              aria-label="Income"
              className="flex flex-col rounded-surface border border-border bg-surface-raised"
            >
              <header className="border-b border-border px-5 py-4">
                <h2 className="text-heading text-ink">Income</h2>
                <p className="text-caption text-ink-muted">
                  Earned profit and other receipts
                </p>
              </header>
              <dl className="flex flex-col divide-y divide-border">
                <IncomeLine
                  label="Earned profit"
                  caption="Profit portion of collections"
                  amount={pnl.data.income.earnedProfit}
                />
                <IncomeLine
                  label="Other receipts"
                  caption="Processing fees, bank interest"
                  amount={pnl.data.income.otherIncome}
                />
              </dl>
              <TotalRow label="Total income" amount={pnl.data.income.total} />
            </section>

            <section
              aria-label="Expenses"
              className="flex flex-col rounded-surface border border-border bg-surface-raised"
            >
              <header className="border-b border-border px-5 py-4">
                <h2 className="text-heading text-ink">Expenses</h2>
                <p className="text-caption text-ink-muted">By expense head</p>
              </header>
              <div className="px-5 py-4">
                {pnl.data.expenses.categories.length === 0 &&
                isNegativeMoney(pnl.data.expenses.writeOffLoss) === false &&
                pnl.data.expenses.writeOffLoss === "0.00" ? (
                  <p className="text-body text-ink-muted">
                    Nothing was spent in the period.
                  </p>
                ) : (
                  <BarRows
                    label="Expenses by head"
                    rows={[
                      ...pnl.data.expenses.categories.map((category) => ({
                        key: category.categoryId,
                        label: category.name,
                        amount: category.amount,
                      })),
                      ...(pnl.data.expenses.writeOffLoss === "0.00"
                        ? []
                        : [
                            {
                              key: "write-off",
                              label: "Written off (bad loans)",
                              amount: pnl.data.expenses.writeOffLoss,
                            },
                          ]),
                    ]}
                  />
                )}
              </div>
              <TotalRow
                label="Total expenses"
                amount={pnl.data.expenses.total}
              />
            </section>
          </div>

          <SixMonths today={today} />

          <Note>
            Lending money is not an expense, and getting it back is not income.
            Only the profit inside each collection counts here.
          </Note>
        </>
      ) : null}
    </>
  );
}

/** The answer first, then how it was reached: income − expenses = result. */
function ResultCard({
  from,
  to,
  income,
  expenses,
  net,
}: {
  from: string;
  to: string;
  income: string;
  expenses: string;
  net: string;
}) {
  const loss = isNegativeMoney(net);
  return (
    <section
      aria-label="Result"
      className="flex flex-col gap-5 rounded-surface border border-border bg-surface-raised p-5 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex flex-col gap-1">
        <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          {loss ? "Net loss" : "Net profit"} · {formatBusinessDate(from)} –{" "}
          {formatBusinessDate(to)}
        </span>
        <span
          className={cn(
            "text-display",
            loss ? "text-critical" : "text-positive",
          )}
          data-numeric
        >
          {signedAmount(net)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        <SumBlock label="Income" amount={income} />
        <span className="text-heading text-ink-muted">−</span>
        <SumBlock label="Expenses" amount={expenses} />
        <span className="text-heading text-ink-muted">=</span>
        <SumBlock
          label={loss ? "Loss" : "Profit"}
          amount={net}
          tone={loss ? "critical" : "positive"}
        />
      </div>
    </section>
  );
}

function SumBlock({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: string;
  tone?: "positive" | "critical";
}) {
  return (
    <span
      className={cn(
        "flex flex-col rounded-control border px-3 py-2",
        tone === "positive" && "border-positive-border bg-positive-subtle",
        tone === "critical" && "border-critical-border bg-critical-subtle",
        !tone && "border-border bg-surface-sunken",
      )}
    >
      <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="text-body font-semibold text-ink" data-numeric>
        {signedAmount(amount)}
      </span>
    </span>
  );
}

function IncomeLine({
  label,
  caption,
  amount,
}: {
  label: string;
  caption: string;
  amount: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3.5">
      <dt className="flex flex-col">
        <span className="text-body text-ink">{label}</span>
        <span className="text-caption text-ink-muted">{caption}</span>
      </dt>
      <dd className="text-body text-ink" data-numeric>
        {signedAmount(amount)}
      </dd>
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="mt-auto flex justify-between gap-4 rounded-b-surface border-t border-border bg-surface-sunken px-5 py-3.5">
      <span className="text-body font-semibold text-ink">{label}</span>
      <span className="text-body font-semibold text-ink" data-numeric>
        {signedAmount(amount)}
      </span>
    </div>
  );
}

/**
 * Six months of income against expenses, one read per month with the same
 * service as the page — so a bar can never disagree with that month's own
 * statement.
 */
function SixMonths({ today }: { today: CalendarDate }) {
  const m5 = startOfMonth(today);
  const m4 = previousMonth(m5);
  const m3 = previousMonth(m4);
  const m2 = previousMonth(m3);
  const m1 = previousMonth(m2);
  const m0 = previousMonth(m1);
  const read = (start: CalendarDate) => ({
    query: { from: start, to: monthEnd(start, today) },
  });
  const months = [
    {
      key: m0,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m0)),
    },
    {
      key: m1,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m1)),
    },
    {
      key: m2,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m2)),
    },
    {
      key: m3,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m3)),
    },
    {
      key: m4,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m4)),
    },
    {
      key: m5,
      pnl: useApiQuery(statementsContract.getProfitAndLoss, read(m5)),
    },
  ];
  const failed = months.find((month) => month.pnl.status === "error");
  const ready = months.every((month) => month.pnl.status === "ready");

  return (
    <section
      aria-label="Last 6 months"
      className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5"
    >
      <div>
        <h2 className="text-heading text-ink">Last 6 months</h2>
        <p className="text-caption text-ink-muted">
          Income and expenses by month
        </p>
      </div>
      {failed && failed.pnl.status === "error" ? (
        <LoadFailed message={failed.pnl.message} onRetry={failed.pnl.reload} />
      ) : !ready ? (
        <Skeleton className="h-48 w-full rounded-control" />
      ) : (
        <AreaChart
          label="Income and expenses, last 6 months"
          series={[
            { id: "income", label: "Income", variant: "area" },
            { id: "expenses", label: "Expenses", variant: "line" },
          ]}
          points={months.map((month) => ({
            key: month.key,
            values:
              month.pnl.status === "ready"
                ? {
                    income: month.pnl.data.income.total,
                    expenses: month.pnl.data.expenses.total,
                  }
                : { income: "0.00", expenses: "0.00" },
          }))}
          formatValue={formatCurrency}
          formatKey={monthName}
          formatKeyLong={monthName}
        />
      )}
    </section>
  );
}
