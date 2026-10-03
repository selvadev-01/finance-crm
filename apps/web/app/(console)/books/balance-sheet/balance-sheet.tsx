"use client";

import { CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";
import { exportContract, statementsContract } from "@repo/contracts";
import { isCalendarDate, toBusinessDate } from "@repo/domain";
import {
  EmptyFrame,
  FilterBar,
  FilterField,
  formatBusinessDate,
  Input,
  ListSkeleton,
  NotPermitted,
  PageHeader,
} from "@repo/ui";
import type { ReactNode } from "react";

import { ExportMenu } from "../../../../components/export-menu";
import { LoadFailed } from "../../../../components/query-state";
import { subtractMoney, sumMoney } from "../../../../lib/money";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { Note, ShareBar, signedAmount } from "../visuals";

export const BALANCE_FILTERS = { date: "" };

/**
 * Books · balance sheet (ADR-0018, US-105; Stitch B-07). What the business
 * has on a day, against whose it is — side by side, with the check that they
 * agree first. When they do not, it is a fault to report, never a figure to
 * adjust.
 */
export function BalanceSheetView({
  initial,
}: {
  initial: Partial<typeof BALANCE_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const { filters, setFilter } = useListState(BALANCE_FILTERS, initial);
  const date =
    filters.date && isCalendarDate(filters.date) && filters.date <= today
      ? filters.date
      : today;
  const sheet = useApiQuery(
    statementsContract.getBalanceSheet,
    allowed ? { query: { date } } : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The ledger is for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  return (
    <>
      <PageHeader
        title="Balance sheet"
        description="Assets, capital and liabilities as of a date."
        actions={
          <ExportMenu
            route={exportContract.balanceSheet}
            query={{ date }}
            disabled={sheet.status !== "ready"}
          />
        }
      />
      <FilterBar summary={formatBusinessDate(date)}>
        <FilterField label="As of" width="sm">
          <Input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setFilter("date", event.target.value)}
          />
        </FilterField>
      </FilterBar>

      {sheet.status === "loading" ? (
        <ListSkeleton columns={2} rows={8} />
      ) : null}
      {sheet.status === "error" ? (
        <LoadFailed message={sheet.message} onRetry={sheet.reload} />
      ) : null}
      {sheet.status === "ready" ? (
        <>
          {sheet.data.balanced ? (
            <p
              role="status"
              className="flex items-center gap-3 rounded-control border border-positive-border bg-positive-subtle px-4 py-3 text-body text-ink"
            >
              <CheckCircle
                aria-hidden
                size={20}
                weight="regular"
                className="shrink-0 text-positive"
              />
              <span>
                Both sides agree —{" "}
                <span className="font-semibold" data-numeric>
                  {signedAmount(sheet.data.assets.total)}
                </span>
                . The books balance.
              </span>
            </p>
          ) : (
            <p
              role="alert"
              className="flex items-start gap-3 rounded-control border border-critical-border bg-critical-subtle px-4 py-3 text-body text-ink"
            >
              <Warning
                aria-hidden
                size={20}
                className="mt-px shrink-0 text-critical"
              />
              The two sides do not agree. Every posting is checked when it is
              written, so this is a fault to report, not a figure to adjust.
            </p>
          )}

          <section
            aria-label="Asset composition"
            className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5"
          >
            <h2 className="text-heading text-ink">Asset composition</h2>
            <ShareBar
              label="Asset share"
              parts={[
                {
                  key: "loans",
                  label: "Loans & advances (net)",
                  amount: subtractMoney(
                    sheet.data.assets.loansReceivable,
                    sheet.data.assets.unearnedProfit,
                  ),
                },
                {
                  key: "banks",
                  label: "Banks",
                  amount: sumMoney(
                    sheet.data.assets.banks.map((bank) => bank.balance),
                  ),
                },
                {
                  key: "office",
                  label: "Cash-in-hand",
                  amount: sheet.data.assets.officeCash,
                },
                {
                  key: "staff",
                  label: "With staff",
                  amount: sumMoney(
                    sheet.data.assets.cashWithStaff.map((p) => p.balance),
                  ),
                },
              ]}
            />
          </section>

          <div className="relative grid items-stretch gap-5 lg:grid-cols-2">
            <SideCard
              caption="Assets"
              title="Assets"
              subtitle={`As of ${formatBusinessDate(date)}`}
              total={sheet.data.assets.total}
            >
              <Line
                label="Cash-in-hand"
                amount={sheet.data.assets.officeCash}
              />
              {sheet.data.assets.banks.map((bank) => (
                <Line key={bank.id} label={bank.name} amount={bank.balance} />
              ))}
              {sheet.data.assets.cashWithStaff.map((person) => (
                <Line
                  key={person.id}
                  label={`Cash with ${person.name} (collection staff)`}
                  note="Not yet handed over"
                  amount={person.balance}
                />
              ))}
              <Line
                label="Loans & advances"
                amount={sheet.data.assets.loansReceivable}
              />
              <Line
                label="Less: Unearned profit"
                note="Profit in the outstanding loan balances"
                amount={sheet.data.assets.unearnedProfit}
                deduct
              />
            </SideCard>
            <span
              aria-hidden
              className="absolute top-1/2 left-1/2 hidden size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-pill border border-border bg-surface-raised text-heading text-ink-muted lg:flex"
            >
              =
            </span>
            <SideCard
              caption="Capital & liabilities"
              title="Capital & liabilities"
              subtitle="Capital A/c, drawings, reserves & surplus"
              total={sheet.data.equity.total}
            >
              <Line
                label="Capital A/c"
                note="Invested by the owner"
                amount={sheet.data.equity.capital}
              />
              <Line
                label="Less: Drawings"
                note="Withdrawn by the owner"
                amount={sheet.data.equity.drawings}
                deduct
              />
              <Line
                label="Reserves & surplus"
                note="Cumulative profit since the books began"
                amount={sheet.data.equity.retainedProfit}
              />
            </SideCard>
          </div>

          <Note>
            If the two sides ever differ, it is a fault to report — never a
            figure to adjust.
          </Note>
        </>
      ) : null}
    </>
  );
}

function SideCard({
  caption,
  title,
  subtitle,
  total,
  children,
}: {
  caption: string;
  title: string;
  subtitle: string;
  total: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={caption}
      className="flex flex-col rounded-surface border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-heading text-ink">{title}</h2>
        <p className="text-caption text-ink-muted">{subtitle}</p>
      </header>
      <dl className="flex flex-col divide-y divide-border">{children}</dl>
      <div className="mt-auto flex justify-between gap-4 rounded-b-surface border-t border-border bg-surface-sunken px-5 py-3.5">
        <span className="text-heading text-ink">Total</span>
        <span className="text-heading text-ink" data-numeric>
          {signedAmount(total)}
        </span>
      </div>
    </section>
  );
}

/** A line of a statement; a deduction reads in brackets, as accountants write it. */
function Line({
  label,
  note,
  amount,
  deduct = false,
}: {
  label: string;
  note?: string;
  amount: string;
  deduct?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="flex flex-col">
        <span
          className={deduct ? "text-body text-ink-muted" : "text-body text-ink"}
        >
          {label}
        </span>
        {note ? (
          <span className="text-caption text-ink-muted">{note}</span>
        ) : null}
      </dt>
      <dd
        className={deduct ? "text-body text-ink-muted" : "text-body text-ink"}
        data-numeric
      >
        {deduct && amount !== "0.00"
          ? `(${signedAmount(amount)})`
          : signedAmount(amount)}
      </dd>
    </div>
  );
}
