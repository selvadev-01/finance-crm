"use client";

import { type Account, accountContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  DataTable,
  DataTableSkeleton,
  Dialog,
  DialogActions,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { apiWrite } from "../../../../lib/api-write";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { LoadFailed, RecordNotFound } from "../../_organisation/list-controls";
import { AccountStatusBadge } from "../account-parts";
import { AccountHistory } from "./account-history";

const SLOT_TONE = {
  PENDING: "neutral",
  COLLECTED: "positive",
  PARTIAL: "warning",
  MISSED: "critical",
  CANCELLED: "neutral",
} as const;

const SLOT_LABEL = {
  PENDING: "Pending",
  COLLECTED: "Collected",
  PARTIAL: "Partial",
  MISSED: "Missed",
  CANCELLED: "Cancelled",
} as const;

export function AccountDetailView({ accountId }: { accountId: string }) {
  const me = useSignedIn();
  const [confirming, setConfirming] = useState(false);
  const account = useApiQuery(accountContract.getAccount, {
    params: { accountId },
  });
  const schedule = useApiQuery(accountContract.getAccountSchedule, {
    params: { accountId },
  });

  if (account.status === "loading")
    return <DataTableSkeleton columns={4} rows={4} />;
  if (account.status === "not-found" || account.status === "not-permitted") {
    return <RecordNotFound noun="Account" />;
  }
  if (account.status === "error") {
    return <LoadFailed message={account.message} onRetry={account.reload} />;
  }

  const record = account.data;
  const today = toBusinessDate(new Date());
  const canDisburse =
    canManageOrganisation(me.role) && record.status === "PENDING";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/customers/${record.customerId}`}
            className="hover:text-ink hover:underline"
          >
            {record.customerName}
          </Link>
        }
        title={<span className="font-mono">{record.accountCode}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge account={record} />
            <span>
              on{" "}
              <Link
                href={`/lines/${record.lineId}`}
                className="hover:text-ink hover:underline"
              >
                {record.lineName}
              </Link>
            </span>
          </span>
        }
        actions={
          canDisburse && record.disbursementDate > today ? (
            <p className="text-sm text-ink-muted">
              Can be disbursed from{" "}
              {formatBusinessDate(record.disbursementDate)}
            </p>
          ) : canDisburse ? (
            <Button tone="primary" onClick={() => setConfirming(true)}>
              Disburse
            </Button>
          ) : null
        }
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Account amount">
          {formatCurrency(record.accountAmount)}
        </Figure>
        {record.investedAmount !== null ? (
          <Figure label="Invested">
            {formatCurrency(record.investedAmount)}
          </Figure>
        ) : null}
        {record.profitAmount !== null ? (
          <Figure label="Profit">{formatCurrency(record.profitAmount)}</Figure>
        ) : null}
        <Figure label="Daily amount">
          {formatCurrency(record.dailyAmount)} · {record.termDays} days
        </Figure>
        <Figure label="Collected">
          {formatCurrency(record.collectedAmount)}
        </Figure>
        <Figure label="Outstanding">
          {formatCurrency(record.outstandingAmount)}
        </Figure>
        <Figure label="Disbursement">
          {formatBusinessDate(record.disbursementDate)}
        </Figure>
        <Figure label="Target completion">
          {formatBusinessDate(record.targetCompletionDate)}
        </Figure>
      </dl>

      <section
        aria-labelledby="account-schedule"
        className="flex flex-col gap-3"
      >
        <h2 id="account-schedule" className="text-base font-semibold text-ink">
          Schedule
        </h2>
        {schedule.status === "loading" ? (
          <DataTableSkeleton columns={4} />
        ) : null}
        {schedule.status === "error" ? (
          <LoadFailed message={schedule.message} onRetry={schedule.reload} />
        ) : null}
        {schedule.status === "ready" ? (
          <DataTable
            caption="Schedule"
            rows={schedule.data.slots}
            rowKey={(slot) => String(slot.sequence)}
            columns={[
              { header: "Day", align: "end", cell: (slot) => slot.sequence },
              {
                header: "Date",
                cell: (slot) => formatBusinessDate(slot.dueDate),
              },
              {
                header: "Expected",
                align: "end",
                cell: (slot) => formatCurrency(slot.expectedAmount),
              },
              {
                header: "Status",
                align: "end",
                cell: (slot) => (
                  <Badge tone={SLOT_TONE[slot.status]}>
                    {SLOT_LABEL[slot.status]}
                  </Badge>
                ),
              },
            ]}
          />
        ) : null}
      </section>

      {/* US-091: the audit substrate is Admin-and-above (M13). */}
      {canManageOrganisation(me.role) ? (
        <AccountHistory accountId={record.id} />
      ) : null}

      {confirming ? (
        <DisburseDialog
          account={record}
          today={today}
          onClose={() => setConfirming(false)}
          onDisbursed={() => {
            setConfirming(false);
            account.reload();
            schedule.reload();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Names the consequence (design-system.md rule 7): the cash that leaves the
 * office, that the amounts lock, and — for an account whose planned day has
 * passed — that it is disbursed today and its schedule moves.
 */
function DisburseDialog({
  account,
  today,
  onClose,
  onDisbursed,
}: {
  account: Account;
  today: string;
  onClose: () => void;
  onDisbursed: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const redated = account.disbursementDate < today;

  async function disburse() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(accountContract.disburseAccount, {
      params: { accountId: account.id },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form);
    onDisbursed();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Disburse ${account.accountCode}`}
      description={`${account.investedAmount ? formatCurrency(account.investedAmount) : "The invested amount"} is handed to ${account.customerName}, who repays ${formatCurrency(account.accountAmount)}. The amounts can no longer be changed.`}
    >
      {redated ? (
        <FormMessage tone="info">
          It was planned for {formatBusinessDate(account.disbursementDate)}. It
          will be disbursed today, {formatBusinessDate(today)}, and the schedule
          will start from the next working day.
        </FormMessage>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          tone="primary"
          onClick={() => void disburse()}
          disabled={pending}
        >
          {pending ? "Disbursing…" : `Disburse ${account.accountCode}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-base font-semibold text-ink" data-numeric>
        {children}
      </dd>
    </div>
  );
}
