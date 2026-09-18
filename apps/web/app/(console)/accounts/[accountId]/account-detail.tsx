"use client";

import {
  type Account,
  accountContract,
  type ScheduleSlotView,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  DataView,
  Dialog,
  DialogActions,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  NothingYet,
  PageHeader,
  Section,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import {
  displayColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ListFallback } from "../../../../components/list-state";
import { PageTrail } from "../../../../components/page-trail";
import { RecordFallback } from "../../../../components/query-state";
import {
  AccountStatusBadge,
  StatusBadge,
} from "../../../../components/status-badge";
import { apiWrite } from "../../../../lib/api-write";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { AccountHistory } from "./account-history";

export function AccountDetailView({ accountId }: { accountId: string }) {
  const me = useSignedIn();
  const [confirming, setConfirming] = useState(false);
  const account = useApiQuery(accountContract.getAccount, {
    params: { accountId },
  });
  const schedule = useApiQuery(accountContract.getAccountSchedule, {
    params: { accountId },
  });

  if (account.status !== "ready") {
    return <RecordFallback query={account} noun="Account" />;
  }

  const record = account.data;
  const today = toBusinessDate(new Date());
  const canDisburse =
    canManageOrganisation(me.role) && record.status === "PENDING";

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Customers", href: "/customers" },
              {
                label: record.customerName,
                href: `/customers/${record.customerId}`,
              },
              { label: record.accountCode },
            ]}
          />
        }
        title={<span className="font-mono">{record.accountCode}</span>}
        meta={
          <>
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
          </>
        }
        actions={
          canDisburse && record.disbursementDate > today ? (
            <p className="text-body text-ink-muted">
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

      <StatGrid columns={4}>
        <Stat label="Account amount">
          {formatCurrency(record.accountAmount)}
        </Stat>
        {record.investedAmount !== null ? (
          <Stat label="Invested">{formatCurrency(record.investedAmount)}</Stat>
        ) : null}
        {record.profitAmount !== null ? (
          <Stat label="Profit">{formatCurrency(record.profitAmount)}</Stat>
        ) : null}
        <Stat label="Daily amount" hint={`${record.termDays} days`}>
          {formatCurrency(record.dailyAmount)}
        </Stat>
        <Stat label="Collected">{formatCurrency(record.collectedAmount)}</Stat>
        <Stat label="Outstanding">
          {formatCurrency(record.outstandingAmount)}
        </Stat>
        <Stat label="Disbursement">
          {formatBusinessDate(record.disbursementDate)}
        </Stat>
        <Stat label="Target completion">
          {formatBusinessDate(record.targetCompletionDate)}
        </Stat>
      </StatGrid>

      <Section title="Schedule">
        {schedule.status === "ready" && schedule.data.slots.length > 0 ? (
          <DataView
            caption="Schedule"
            rows={schedule.data.slots}
            getRowId={(slot) => String(slot.sequence)}
            complete
            columns={[
              valueColumn<ScheduleSlotView>({
                id: "day",
                header: "Day",
                align: "end",
                value: (slot) => slot.sequence,
              }),
              valueColumn<ScheduleSlotView>({
                id: "date",
                header: "Date",
                value: (slot) => slot.dueDate,
                cell: (slot) => formatBusinessDate(slot.dueDate),
              }),
              moneyColumn<ScheduleSlotView>({
                id: "expected",
                header: "Expected",
                amount: (slot) => slot.expectedAmount,
              }),
              displayColumn<ScheduleSlotView>({
                id: "status",
                header: "Status",
                align: "end",
                cell: (slot) => <StatusBadge kind="slot" value={slot.status} />,
              }),
            ]}
          />
        ) : (
          <ListFallback
            query={schedule}
            columns={4}
            empty={
              <NothingYet
                title="No schedule slots"
                description="The schedule appears once the account's days are generated."
              />
            }
          />
        )}
      </Section>

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
