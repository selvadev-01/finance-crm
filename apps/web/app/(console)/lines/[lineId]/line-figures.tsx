"use client";

import { reportContract } from "@repo/contracts";
import { startOfMonth, toBusinessDate } from "@repo/domain";
import {
  arrowLinkClass,
  formatCurrency,
  ListSkeleton,
  Section,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";

import { LoadFailed } from "../../../../components/query-state";
import { useApiQuery } from "../../../../lib/use-api-query";
import { UNAVAILABLE, Unknown } from "../../dashboard/dashboard-parts";

/**
 * A line's §14 figures (M03 line overview, US-011): its book now, what its
 * accounts were disbursed on, and today's collection — read from the
 * line-wise report (US-084), the one place those figures are computed, so the
 * line page and the report can never disagree. A group the API could not
 * work out is shown as unavailable, never as zero.
 */
export function LineFigures({ lineId }: { lineId: string }) {
  const today = toBusinessDate(new Date());
  const report = useApiQuery(reportContract.getLineWise, {
    query: { from: today, to: today, lineId },
  });
  const row =
    report.status === "ready"
      ? (report.data.lines?.find((line) => line.lineId === lineId) ?? null)
      : null;
  const money = (value: string | undefined) =>
    value === undefined ? <Unknown /> : formatCurrency(value);

  return (
    <Section
      title="Collections and money"
      description="The line’s customers and accounts now, what they were lent on, and today’s collection."
      actions={
        <Link
          href={`/reports/line-wise?line=${lineId}&from=${startOfMonth(today)}&to=${today}`}
          className={arrowLinkClass}
        >
          This month in the line-wise report →
        </Link>
      }
    >
      {report.status === "loading" ? (
        <ListSkeleton columns={4} rows={2} />
      ) : null}
      {report.status === "error" ? (
        <LoadFailed message={report.message} onRetry={report.reload} />
      ) : null}
      {report.status === "ready" ? (
        <>
          <StatGrid columns={4} aria-label="The line’s book">
            <Stat label="Customers" hint={row?.book ? undefined : UNAVAILABLE}>
              {row?.book ? (
                <span data-numeric>{row.book.customers}</span>
              ) : (
                <Unknown />
              )}
            </Stat>
            <Stat
              label="Active accounts"
              hint={
                row?.book
                  ? `${row.book.completedAccounts} completed`
                  : UNAVAILABLE
              }
            >
              {row?.book ? (
                <span data-numeric>{row.book.activeAccounts}</span>
              ) : (
                <Unknown />
              )}
            </Stat>
            <Stat
              label="Account value"
              hint={row?.amounts ? "as disbursed" : UNAVAILABLE}
            >
              {money(row?.amounts?.accountAmount)}
            </Stat>
            <Stat
              label="Invested"
              hint={
                row?.amounts
                  ? `${formatCurrency(row.amounts.profit)} profit`
                  : UNAVAILABLE
              }
            >
              {money(row?.amounts?.invested)}
            </Stat>
          </StatGrid>
          <StatGrid columns={4} aria-label="Today’s collection">
            <Stat
              label="Expected today"
              hint={row?.collections ? undefined : UNAVAILABLE}
            >
              {money(row?.collections?.expected)}
            </Stat>
            <Stat label="Collected today">
              {money(row?.collections?.collected)}
            </Stat>
            <Stat label="Pending">{money(row?.collections?.pending)}</Stat>
            <Stat label="Extra">{money(row?.collections?.extra)}</Stat>
          </StatGrid>
        </>
      ) : null}
    </Section>
  );
}
