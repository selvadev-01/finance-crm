"use client";

import { ChartLineUp } from "@phosphor-icons/react/dist/ssr";
import {
  dashboardContract,
  TREND_DAYS,
  type TrendPoint,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate } from "@repo/domain";
import {
  AreaChart,
  Card,
  DeltaChip,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  Skeleton,
} from "@repo/ui";

import { signedCurrency } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { compareMoney, isZeroMoney, subtractMoney } from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";
import { WEEKDAYS } from "./dashboard-parts";

/**
 * The dashboards' trend (S-07, S-19, S-20): expected against collected per
 * working day, ending on the date shown. Read on its own, so the page's
 * figures never wait for it, and a trend that fails leaves them standing.
 * `null` skips the read — a future date, or a Senior with no line.
 */
export function useTrend(date: string | null, lineId?: string) {
  return useApiQuery(
    dashboardContract.getTrend,
    date === null ? null : { query: { date, ...(lineId ? { lineId } : {}) } },
  );
}

type Trend = ReturnType<typeof useTrend>;

const SERIES = [
  { id: "collected", label: "Collected", variant: "area" },
  { id: "expected", label: "Expected", variant: "line" },
] as const;

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function longDate(date: string) {
  return `${WEEKDAYS[dayOfWeek(parseCalendarDate(date))]} ${formatBusinessDate(date)}`;
}

/**
 * Collected on the date shown against the working day before it, for the
 * Collected tile. Nothing when the trend is unknown or has no earlier day —
 * never a "+₹0.00" standing in for "we don't know".
 */
export function collectedDelta(trend: Trend, shown: string) {
  if (trend.status !== "ready" || trend.data.points === null) return null;
  const points = trend.data.points;
  const last = points.at(-1);
  const before = points.at(-2);
  if (!last || !before || last.businessDate !== shown) return null;
  const change = subtractMoney(last.collected, before.collected);
  const direction = compareMoney(change, "0.00");
  return (
    <DeltaChip
      direction={direction === 0 ? "flat" : direction > 0 ? "up" : "down"}
      tone={
        direction === 0 ? "neutral" : direction > 0 ? "positive" : "critical"
      }
      comparedWith={`vs ${SHORT_WEEKDAYS[dayOfWeek(parseCalendarDate(before.businessDate))]}`}
    >
      {signedCurrency(change)}
    </DeltaChip>
  );
}

export function TrendCard({
  trend,
  scope,
}: {
  trend: Trend;
  /** Whose lines: "every line" or the line's name. */
  scope: string;
}) {
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title={
          <span className="flex items-center gap-2">
            <ChartLineUp aria-hidden size={18} className="text-accent" />
            Collections trend
          </span>
        }
        actions={
          <span className="text-caption text-ink-muted">
            Last {TREND_DAYS} working days · {scope}
          </span>
        }
      />
      <Card.Body className="pt-2">
        <TrendBody trend={trend} />
      </Card.Body>
    </Card.Root>
  );
}

function TrendBody({ trend }: { trend: Trend }) {
  switch (trend.status) {
    case "loading":
      return (
        <div role="status" aria-label="Loading the trend">
          <Skeleton className="h-48 w-full rounded-control sm:h-56" />
        </div>
      );
    case "not-found":
    case "not-permitted":
      return (
        <FormMessage tone="info">
          The trend isn’t available to you here.
        </FormMessage>
      );
    case "error":
      return <LoadFailed message={trend.message} onRetry={trend.reload} />;
  }
  const { points } = trend.data;
  if (points === null) {
    return (
      <FormMessage tone="critical">
        The trend couldn’t be worked out just now, so it is not shown.
      </FormMessage>
    );
  }
  if (points.every(isQuiet)) {
    return (
      <p className="py-10 text-center text-body text-ink-muted">
        Nothing was due or collected in the last {points.length} working days.
      </p>
    );
  }
  return (
    <AreaChart
      label={`Collected against expected, last ${points.length} working days`}
      series={SERIES}
      points={points.map((point) => ({
        key: point.businessDate,
        values: { collected: point.collected, expected: point.expected },
      }))}
      formatValue={formatCurrency}
      formatKey={(date) => formatBusinessDate(date, "day-month")}
      formatKeyLong={longDate}
    />
  );
}

const isQuiet = (point: TrendPoint) =>
  isZeroMoney(point.expected) && isZeroMoney(point.collected);
