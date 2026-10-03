"use client";

import {
  type Account,
  accountContract,
  booksMoneyContract,
  type ScheduleSlotView,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  buttonClass,
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
  toast,
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
import { CADENCE } from "../../../../lib/cadence";
import { isNegativeMoney, subtractMoney } from "../../../../lib/money";
import { signedAmount } from "../../books/visuals";
import {
  canApproveAccount,
  canDisburse,
  canManageOrganisation,
} from "../../../../lib/roles";
import { CloseAccount } from "./close-account";
import { CorrectTerms } from "./correct-terms";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { AccountHistory } from "./account-history";

export function AccountDetailView({ accountId }: { accountId: string }) {
  const me = useSignedIn();
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [approving, setApproving] = useState(false);
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

  async function approve() {
    setApproving(true);
    const result = await apiWrite(accountContract.approveAccount, {
      params: { accountId },
    });
    setApproving(false);
    if (!result.ok) {
      toast({
        title: result.form ?? "The account was not approved.",
        tone: "critical",
      });
      return;
    }
    toast({ title: `${record.accountCode} approved` });
    account.reload();
  }
  const today = toBusinessDate(new Date());
  const canClose = me.role === "SUPER_ADMIN" && record.status === "ACTIVE";
  const pending = canManageOrganisation(me.role) && record.status === "PENDING";
  // Paying the money out is the Super Admin's alone (decided 2026-10-02).
  const mayDisburse = pending && canDisburse(me.role);
  // A Senior's account waits for an Admin or the Super Admin (decided
  // 2026-10-03); the Super Admin's disbursement approves it on the way.
  const awaitingApproval =
    record.status === "PENDING" && record.approvedAt === null;
  const mayApprove =
    awaitingApproval && canApproveAccount(me.role) && !mayDisburse;

  const actions = [
    awaitingApproval && !canApproveAccount(me.role) ? (
      <p key="approval" className="text-body text-ink-muted">
        Waiting for an Admin to approve
      </p>
    ) : null,
    mayApprove ? (
      <Button
        aria-busy={approving || undefined}
        key="approve"
        tone="primary"
        disabled={approving}
        onClick={() => void approve()}
      >
        {approving ? "Approving…" : "Approve"}
      </Button>
    ) : null,
    pending && record.disbursementDate > today ? (
      <p key="waiting" className="text-body text-ink-muted">
        Can be disbursed from {formatBusinessDate(record.disbursementDate)}
      </p>
    ) : mayDisburse ? (
      <Button
        key="disburse"
        tone="primary"
        disabled={approving}
        onClick={() => setConfirming(true)}
      >
        {awaitingApproval ? "Approve and disburse" : "Disburse"}
      </Button>
    ) : pending && !awaitingApproval ? (
      <p key="owner" className="text-body text-ink-muted">
        Waiting for the Super Admin to disburse
      </p>
    ) : null,
    // US-030: terms are correctable only before disbursement.
    pending ? (
      <Button
        key="correct"
        disabled={approving}
        onClick={() => setCorrecting(true)}
      >
        Correct terms
      </Button>
    ) : null,
    // US-035: Super Admin only, and only while there is still something to
    // stop collecting.
    canClose ? (
      <Button key="close" tone="danger" onClick={() => setClosing(true)}>
        Close account
      </Button>
    ) : null,
  ].filter(Boolean);

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
        // Nothing at all for someone who can neither disburse nor close, so
        // the header draws no empty action row.
        actions={actions.length > 0 ? <>{actions}</> : null}
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
        {/* BR-04: the label and the unit follow the account's own cadence, so
            a weekly account is never read as a daily one. */}
        <Stat
          label={CADENCE[record.collectionFrequency].amountShort}
          hint={`${record.termDays} ${CADENCE[record.collectionFrequency].termUnit}`}
        >
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
                // On the phone card the day heads the row with its date under
                // it, so a hundred-day schedule is a hundred short rows.
                cell: (slot) => (
                  <span className="flex flex-col">
                    <span data-numeric>
                      <span className="md:hidden">Day </span>
                      {slot.sequence}
                    </span>
                    <span className="text-caption text-ink-muted md:hidden">
                      {formatBusinessDate(slot.dueDate)}
                    </span>
                  </span>
                ),
              }),
              {
                ...valueColumn<ScheduleSlotView>({
                  id: "date",
                  header: "Date",
                  value: (slot) => slot.dueDate,
                  cell: (slot) => formatBusinessDate(slot.dueDate),
                }),
                meta: { hideOnCard: true },
              },
              moneyColumn<ScheduleSlotView>({
                id: "expected",
                header: "Expected",
                amount: (slot) => slot.expectedAmount,
                card: "headline",
              }),
              displayColumn<ScheduleSlotView>({
                id: "status",
                header: "Status",
                align: "end",
                card: "status",
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

      {correcting ? (
        <CorrectTerms
          account={record}
          onClose={() => setCorrecting(false)}
          onDone={() => {
            setCorrecting(false);
            account.reload();
            schedule.reload();
          }}
        />
      ) : null}

      {closing ? (
        <CloseAccount
          account={record}
          onClose={() => setClosing(false)}
          onDone={() => {
            setClosing(false);
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
  // The loan is paid from cash-in-hand (decided 2026-10-02): show what is
  // there now and after, and stop here when it is not enough.
  const books = useApiQuery(booksMoneyContract.getBooksOverview, {
    query: {},
  });
  const invested = account.investedAmount;
  const held = books.status === "ready" ? books.data.officeCash : null;
  const after =
    held !== null && invested ? subtractMoney(held, invested) : null;
  const short = after !== null && isNegativeMoney(after);

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
      {held !== null && after !== null ? (
        <dl
          aria-label="Cash in hand"
          className="grid grid-cols-2 gap-3 rounded-control bg-surface-sunken px-4 py-3"
        >
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-ink-muted">Cash in hand now</dt>
            <dd className="text-heading text-ink" data-numeric>
              {signedAmount(held)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-ink-muted">After this loan</dt>
            <dd
              className={
                short ? "text-heading text-critical" : "text-heading text-ink"
              }
              data-numeric
            >
              {signedAmount(after)}
            </dd>
          </div>
        </dl>
      ) : null}
      {short ? (
        <FormMessage
          tone="critical"
          action={
            <Link
              href="/books/money?action=capital"
              className={buttonClass("secondary", undefined, "sm")}
            >
              Add money
            </Link>
          }
        >
          Not enough cash in hand to give {formatCurrency(invested!)}. Add money
          first.
        </FormMessage>
      ) : null}
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
          aria-busy={pending || undefined}
          tone="primary"
          onClick={() => void disburse()}
          disabled={pending || short}
        >
          {pending ? "Disbursing…" : `Disburse ${account.accountCode}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
