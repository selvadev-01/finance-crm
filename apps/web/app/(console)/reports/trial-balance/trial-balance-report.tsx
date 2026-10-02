"use client";

import {
  exportContract,
  ledgerContract,
  type TrialBalance,
  type TrialBalanceRow as Row,
} from "@repo/contracts";
import {
  type CalendarDate,
  isCalendarDate,
  startOfMonth,
  toBusinessDate,
} from "@repo/domain";
import {
  Badge,
  buttonClass,
  DataView,
  EmptyFrame,
  FilterBar,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  Input,
  ListSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
} from "@repo/ui";

import Link from "next/link";

import { displayColumn, moneyColumn } from "../../../../components/columns";
import { ExportMenu } from "../../../../components/export-menu";
import { PageTrail } from "../../../../components/page-trail";
import { LoadFailed } from "../../../../components/query-state";
import { formatTimestamp } from "../../../../lib/format";
import { isZeroMoney } from "../../../../lib/money";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";

const FILTERS = { date: "" };

/** What each ledger account is, in the business's words (M09). */
const ACCOUNT: Record<Row["accountType"], { name: string; note: string }> = {
  CASH_AT_OFFICE: {
    name: "Cash at office",
    note: "Capital in, disbursements out, Seniors' cash handed in",
  },
  CASH_IN_HAND: { name: "Cash in hand", note: "Collected, not yet handed on" },
  LOAN_RECEIVABLE: {
    name: "Loan receivables",
    note: "Still owed by customers",
  },
  WRITE_OFF_LOSS: {
    name: "Write-off loss",
    note: "Written-off accounts, less profit never earned",
  },
  CAPITAL: { name: "Capital", note: "Money put into the business" },
  UNEARNED_PROFIT: {
    name: "Unearned profit",
    note: "Profit on money not yet collected (BR-18)",
  },
  EARNED_PROFIT: {
    name: "Earned profit",
    note: "Profit on money collected (BR-18)",
  },
  EXPENSE: { name: "Expense", note: "Spent running the business" },
  BANK: { name: "Bank", note: "Money held in the bank" },
  OTHER_INCOME: {
    name: "Other income",
    note: "Earned outside collections",
  },
  OWNER_DRAWINGS: {
    name: "Owner drawings",
    note: "Taken out of the business by the owner",
  },
};

function accountName(row: Row): string {
  if (row.accountType === "CASH_IN_HAND")
    return `Cash in hand · ${row.ownerName ?? "Former staff"}`;
  if (row.accountType === "EXPENSE" || row.accountType === "BANK")
    return `${ACCOUNT[row.accountType].name} · ${row.referenceName ?? "Unnamed"}`;
  if (row.accountType === "LOAN_RECEIVABLE")
    return `Loan receivables · ${row.accounts} ${row.accounts === 1 ? "account" : "accounts"}`;
  return ACCOUNT[row.accountType].name;
}

/** A balance cell: the amount on its side, a dash on the other. */
const side = (amount: string) =>
  isZeroMoney(amount) ? "—" : formatCurrency(amount);

/**
 * M09 · the trial balance. Every ledger account's balance from its entries up
 * to a business date, on its normal side, with the two sides' totals — which
 * must agree. Read-only: the ledger is written only by the business events
 * that post to it. Admins and Super Admins (`ledger.view`); the API refuses
 * anyone else regardless.
 */
export function TrialBalanceReport({
  initial,
}: {
  initial: Partial<typeof FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const { filters, setFilter } = useListState(FILTERS, initial);
  const date =
    filters.date && isCalendarDate(filters.date) && filters.date <= today
      ? filters.date
      : today;
  const trial = useApiQuery(
    ledgerContract.getTrialBalance,
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
        trail={
          <PageTrail
            steps={[
              { label: "Reports", href: "/reports" },
              { label: "Trial balance" },
            ]}
          />
        }
        title="Trial balance"
        actions={
          <>
            <Link
              href={`/reports/trial-balance/postings?from=${startOfMonth(date)}&to=${date}`}
              className={buttonClass("secondary")}
            >
              View postings
            </Link>
            <ExportMenu
              route={exportContract.trialBalance}
              query={{ date }}
              disabled={trial.status !== "ready"}
            />
          </>
        }
        description="Every ledger account’s balance from its postings, on its own side. The two sides must agree — every posting is balanced when it is written."
        meta={
          <>
            <span>As of {formatBusinessDate(date)}</span>
            {trial.status === "ready" ? (
              <span>
                updated {formatTimestamp(trial.data.generatedAt, "clock")}
              </span>
            ) : null}
          </>
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
      {trial.status === "ready" ? (
        <TrialBody trial={trial.data} date={date} />
      ) : trial.status === "error" ? (
        <LoadFailed message={trial.message} onRetry={trial.reload} />
      ) : trial.status === "loading" ? (
        <ListSkeleton columns={3} />
      ) : (
        <EmptyFrame>
          <NotPermitted description="The ledger is for Super Admins and Admins." />
        </EmptyFrame>
      )}
    </>
  );
}

function TrialBody({
  trial,
  date,
}: {
  trial: TrialBalance;
  date: CalendarDate;
}) {
  if (trial.rows.length === 0) {
    return (
      <EmptyFrame>
        <NothingYet
          title="Nothing posted yet"
          description="The ledger fills as accounts are disbursed, capital is recorded and cash is collected."
        />
      </EmptyFrame>
    );
  }
  return (
    <>
      {trial.balanced ? null : (
        <FormMessage tone="critical">
          The two sides do not agree. Every posting is checked when it is
          written, so this is a fault to report, not a figure to adjust.
        </FormMessage>
      )}
      <DataView
        caption="Trial balance"
        rows={trial.rows}
        getRowId={(row) =>
          `${row.accountType}:${row.ownerUserId ?? row.referenceId ?? ""}`
        }
        complete
        columns={[
          displayColumn<Row>({
            id: "account",
            header: "Account",
            card: "headline",
            cell: (row) => (
              <span className="flex flex-col">
                {row.ledgerAccountId ? (
                  // ADR-0018: one account opens its statement, month to date.
                  <Link
                    href={`/books/statements/${row.ledgerAccountId}?from=${startOfMonth(date)}&to=${date}`}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {accountName(row)}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">
                    {accountName(row)}
                  </span>
                )}
                <span className="text-caption text-ink-muted">
                  {ACCOUNT[row.accountType].note}
                </span>
              </span>
            ),
          }),
          moneyColumn<Row>({
            id: "debit",
            header: "Debit",
            amount: (row) => row.debitBalance,
            render: (row) => side(row.debitBalance),
          }),
          moneyColumn<Row>({
            id: "credit",
            header: "Credit",
            amount: (row) => row.creditBalance,
            render: (row) => side(row.creditBalance),
          }),
        ]}
        footer={
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-ink-muted">
            <div className="flex gap-1.5">
              <dt>Total debit</dt>
              <dd data-numeric className="text-ink">
                {formatCurrency(trial.totals.debitBalance)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Total credit</dt>
              <dd data-numeric className="text-ink">
                {formatCurrency(trial.totals.creditBalance)}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Check</dt>
              <dd>
                <Badge tone={trial.balanced ? "positive" : "critical"}>
                  {trial.balanced ? "Balanced" : "Out of balance"}
                </Badge>
              </dd>
            </div>
          </dl>
        }
      />
    </>
  );
}
