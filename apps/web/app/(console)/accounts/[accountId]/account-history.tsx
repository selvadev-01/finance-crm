"use client";

import { type AccountHistoryEvent, auditContract } from "@repo/contracts";
import {
  Card,
  formatBusinessDate,
  formatCurrency,
  ListSkeleton,
  Section,
} from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { LoadFailed } from "../../../../components/query-state";
import {
  CollectionEntryBadge,
  StatusBadge,
  statusLabel,
} from "../../../../components/status-badge";
import {
  ActionBadge,
  actorText,
  SnapshotDiff,
  tableLabel,
} from "../../../../lib/audit/audit-parts";
import { formatTimestamp } from "../../../../lib/format";
import { isZeroMoney } from "../../../../lib/money";
import { useApiQuery } from "../../../../lib/use-api-query";

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
    <Section title="History">
      {history.status === "loading" ? (
        <ListSkeleton columns={3} rows={3} />
      ) : null}
      {history.status === "error" ? (
        <LoadFailed message={history.message} onRetry={history.reload} />
      ) : null}
      {history.status === "ready" ? (
        history.data.events.length === 0 ? (
          <p className="text-body text-ink-muted">
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
    </Section>
  );
}

/** One event: what happened on the left, when on the right, detail below. */
function EventCard({
  when,
  title,
  children,
}: {
  when: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card.Root>
      <Card.Body className="gap-1.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="flex flex-wrap items-center gap-2 text-body text-ink">
            {title}
          </span>
          <span className="text-caption text-ink-muted" data-numeric>
            {formatTimestamp(when, "full")}
          </span>
        </div>
        {children}
      </Card.Body>
    </Card.Root>
  );
}

function HistoryEvent({ event }: { event: AccountHistoryEvent }) {
  if (event.kind === "AUDIT") {
    const { entry } = event;
    return (
      <EventCard
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
          <summary className="cursor-pointer text-body text-accent">
            What changed
          </summary>
          <div className="pt-2">
            <SnapshotDiff before={entry.before} after={entry.after} />
          </div>
        </details>
      </EventCard>
    );
  }

  if (event.kind === "DAY_CLOSE") {
    return (
      <EventCard
        when={event.at}
        title={
          <>
            <span>Day</span>
            <StatusBadge kind="day" value={event.status} />
            <Link
              href={`/lines/${event.lineId}/day-closes/${event.businessDate}`}
              className="hover:underline"
            >
              {event.lineName} · {formatBusinessDate(event.businessDate)}
            </Link>
          </>
        }
      >
        <p className="text-body text-ink-muted" data-numeric>
          Collected {formatCurrency(event.collectedTotal)} of{" "}
          {formatCurrency(event.expectedTotal)}
          {!isZeroMoney(event.discrepancy)
            ? ` · cash difference ${formatCurrency(event.discrepancy)}`
            : ""}
          {event.closedBy ? ` · closed by ${event.closedBy.name}` : ""}
        </p>
        {event.reopenReason ? (
          <p className="text-body text-ink-muted">
            Reopened: {event.reopenReason}
          </p>
        ) : null}
      </EventCard>
    );
  }

  // An original is always CONFIRMED (data-dictionary: REVERSED is unused), so
  // its badge shows the BR-08 classification; a correction's badge shows its
  // decision state (US-044).
  const correction = event.entryType === "ADJUSTMENT";
  return (
    <EventCard
      when={event.at}
      title={
        <>
          <CollectionEntryBadge entry={event} />
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
      <p className="text-body text-ink-muted">
        {correction ? "Requested for" : "Collected by"} {event.collector.name}
        {event.note ? ` · “${event.note}”` : ""}
      </p>
      {event.approval ? (
        <p className="text-body text-ink-muted">
          {event.approval.requestedBy.name} asked: {event.approval.reason}.{" "}
          {event.approval.decidedBy
            ? `${statusLabel("decision", event.approval.decision)} by ${event.approval.decidedBy.name}${event.approval.decisionNote ? ` — ${event.approval.decisionNote}` : ""}.`
            : "Waiting for a decision."}
        </p>
      ) : null}
    </EventCard>
  );
}
