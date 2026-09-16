"use client";

import { type AccountHistoryEvent, auditContract } from "@repo/contracts";
import {
  Badge,
  DataTableSkeleton,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  ActionBadge,
  actorText,
  SnapshotDiff,
  tableLabel,
  WHEN,
} from "../../../../lib/audit/audit-parts";
import { useApiQuery } from "../../../../lib/use-api-query";
import { LoadFailed } from "../../_organisation/list-controls";

const CLASSIFICATION = {
  CORRECT: { label: "Correct", tone: "positive" },
  LOW: { label: "Low", tone: "warning" },
  EXTRA: { label: "Extra", tone: "info" },
  NO_PAYMENT: { label: "No payment", tone: "critical" },
} as const;

const COLLECTION_STATUS = {
  PENDING_APPROVAL: "Waiting for approval",
  CONFIRMED: "Confirmed",
  REVERSED: "Reversed",
  REJECTED: "Rejected",
} as const;

const DAY_STATUS = {
  OPEN: "Open",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  TALLIED: "Tallied",
} as const;

/**
 * US-091 on the account page, for Admins: everything that happened to the
 * account, oldest first — created, disbursed, every collection with its
 * variance and collector, corrections with who asked and who decided, and the
 * day closes those collections fell in. The screen for a disputed figure.
 */
export function AccountHistory({ accountId }: { accountId: string }) {
  const history = useApiQuery(auditContract.getAccountHistory, {
    params: { accountId },
  });

  return (
    <section aria-labelledby="account-history" className="flex flex-col gap-3">
      <h2 id="account-history" className="text-base font-semibold text-ink">
        History
      </h2>
      {history.status === "loading" ? (
        <DataTableSkeleton columns={3} rows={3} />
      ) : null}
      {history.status === "error" ? (
        <LoadFailed message={history.message} onRetry={history.reload} />
      ) : null}
      {history.status === "ready" ? (
        history.data.events.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing has been recorded for this account yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="account-history">
            {history.data.events.map((event, index) => (
              <li key={`${event.kind}-${index}`}>
                <HistoryEvent event={event} />
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

function Card({
  when,
  title,
  children,
}: {
  when: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
          {title}
        </span>
        <span className="text-2xs text-ink-muted" data-numeric>
          {WHEN.format(new Date(when))}
        </span>
      </div>
      {children}
    </div>
  );
}

function HistoryEvent({ event }: { event: AccountHistoryEvent }) {
  if (event.kind === "AUDIT") {
    const { entry } = event;
    return (
      <Card
        when={event.at}
        title={
          <>
            <ActionBadge action={entry.action} />
            <span>
              {tableLabel(entry.entityTable)} · {actorText(entry)}
            </span>
          </>
        }
      >
        <details>
          <summary className="cursor-pointer text-sm text-accent">
            What changed
          </summary>
          <div className="pt-2">
            <SnapshotDiff before={entry.before} after={entry.after} />
          </div>
        </details>
      </Card>
    );
  }

  if (event.kind === "DAY_CLOSE") {
    return (
      <Card
        when={event.at}
        title={
          <>
            <Badge tone="neutral">
              Day {DAY_STATUS[event.status].toLowerCase()}
            </Badge>
            <Link
              href={`/lines/${event.lineId}/day-closes/${event.businessDate}`}
              className="hover:underline"
            >
              {event.lineName} · {formatBusinessDate(event.businessDate)}
            </Link>
          </>
        }
      >
        <p className="text-sm text-ink-muted" data-numeric>
          Collected {formatCurrency(event.collectedTotal)} of{" "}
          {formatCurrency(event.expectedTotal)}
          {event.discrepancy !== "0.00"
            ? ` · cash difference ${formatCurrency(event.discrepancy)}`
            : ""}
          {event.closedBy ? ` · closed by ${event.closedBy.name}` : ""}
        </p>
        {event.reopenReason ? (
          <p className="text-sm text-ink-muted">
            Reopened: {event.reopenReason}
          </p>
        ) : null}
      </Card>
    );
  }

  const classification = CLASSIFICATION[event.classification];
  const correction = event.entryType === "ADJUSTMENT";
  return (
    <Card
      when={event.at}
      title={
        <>
          {correction ? (
            <Badge tone="neutral">Correction</Badge>
          ) : (
            <Badge tone={classification.tone} className="text-ink">
              {classification.label}
            </Badge>
          )}
          <Link
            href={`/collections/${event.collectionId}`}
            className="hover:underline"
            data-numeric
          >
            {correction
              ? `${formatCurrency(event.amount)} change · dated ${formatBusinessDate(event.businessDate)}`
              : `${formatCurrency(event.amount)} of ${formatCurrency(event.expectedAmount)} · ${formatBusinessDate(event.businessDate)}`}
          </Link>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        {correction ? "Requested for" : "Collected by"} {event.collector.name} ·{" "}
        {COLLECTION_STATUS[event.status]}
        {event.note ? ` · “${event.note}”` : ""}
      </p>
      {event.approval ? (
        <p className="text-sm text-ink-muted">
          {event.approval.requestedBy.name} asked: {event.approval.reason}.{" "}
          {event.approval.decidedBy
            ? `${event.approval.decision === "APPROVED" ? "Approved" : "Rejected"} by ${event.approval.decidedBy.name}${event.approval.decisionNote ? ` — ${event.approval.decisionNote}` : ""}.`
            : "Waiting for a decision."}
        </p>
      ) : null}
    </Card>
  );
}
