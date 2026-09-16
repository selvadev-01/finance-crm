import {
  ArrowClockwise,
  CaretLeft,
  CheckCircle,
  Money,
  SignOut,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Dialog,
  DialogActions,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import type { OutboxEntry } from "../../lib/offline/db";
import type { OutboxSummary } from "../../lib/offline/outbox";
import { backToRoute, openView } from "./hash-view";
import { EntryStateMark, formatClockTime } from "./sync-marks";

/**
 * S-03 · Sync status — "is my day safe". Everything not yet sent, with when it
 * was captured, how often it was tried and why it last failed. A refused
 * collection cannot be retried into success: the Junior removes it only after
 * confirming they will hand the money to the office (decision 2026-09-14).
 */
export function SyncScreen({
  entries,
  summary,
  lastSync,
  businessDate,
  connected,
  sending,
  signOutBlocked,
  onSendNow,
  onRetry,
  onRemoveRefused,
  onSignOut,
}: {
  entries: OutboxEntry[];
  summary: OutboxSummary | null;
  lastSync: string | null;
  businessDate: string;
  connected: boolean;
  sending: boolean;
  signOutBlocked: boolean;
  onSendNow: () => void;
  onRetry: (entry: OutboxEntry) => void;
  onRemoveRefused: (entry: OutboxEntry) => Promise<void>;
  onSignOut: () => void;
}) {
  const [removing, setRemoving] = useState<OutboxEntry | null>(null);
  const unsent = entries.filter((entry) => entry.status !== "SYNCED");
  const sent = entries.filter((entry) => entry.status === "SYNCED").reverse();
  const lastSent = lastSync
    ? `Last sent ${formatClockTime(lastSync)}`
    : "Nothing sent from this phone yet";

  return (
    <div className="flex flex-col gap-[var(--stack-gap)]" data-testid="sync">
      <div>
        <Button tone="ghost" onClick={backToRoute} className="-ml-3">
          <CaretLeft aria-hidden size={20} weight="regular" />
          Route
        </Button>
      </div>

      {unsent.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-6 text-center"
          data-testid="all-synced"
        >
          <CheckCircle
            aria-hidden
            size={40}
            weight="fill"
            className="text-positive"
          />
          <h1 className="text-xl font-semibold text-ink">
            Everything is sent to the office
          </h1>
          <p className="text-sm text-ink-muted">{lastSent}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-ink" data-numeric>
            {unsent.length === 1
              ? "1 collection not sent"
              : `${unsent.length} collections not sent`}
          </h1>
          <p className="text-sm text-ink-muted">{lastSent}</p>
          {!connected ? (
            <FormMessage tone="info">
              No signal. They are safe on this phone and send by themselves when
              signal returns.
            </FormMessage>
          ) : null}
          <Button tone="primary" onClick={onSendNow} disabled={sending}>
            <ArrowClockwise
              aria-hidden
              size={20}
              weight="regular"
              className={sending ? "animate-spin" : undefined}
            />
            Send now
          </Button>
        </div>
      )}

      {summary?.pausedForSignIn ? (
        <FormMessage tone="critical">
          Your sign-in has expired.{" "}
          <Link href="/sign-in" className="font-medium underline">
            Sign in again
          </Link>{" "}
          — the collections stay on this phone and send after.
        </FormMessage>
      ) : null}
      {summary?.blocked ? (
        <FormMessage tone="critical">
          This phone is full of unsent collections. Find signal and send them
          before recording more.
        </FormMessage>
      ) : summary?.warn ? (
        <FormMessage tone="critical">
          Many collections are waiting. Find signal to send them.
        </FormMessage>
      ) : null}

      {unsent.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="outbox">
          {unsent.map((entry) => (
            <EntryRow
              key={entry.idempotencyKey}
              entry={entry}
              businessDate={businessDate}
            >
              {entry.status === "QUEUED" ? (
                <Button
                  tone="secondary"
                  onClick={() => onRetry(entry)}
                  disabled={sending}
                >
                  Retry
                </Button>
              ) : entry.status === "FAILED" ? (
                <Button tone="secondary" onClick={() => setRemoving(entry)}>
                  Hand in and remove
                </Button>
              ) : null}
            </EntryRow>
          ))}
        </ul>
      ) : null}

      {sent.length > 0 ? (
        <details className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
          <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center px-4 text-sm font-medium text-ink">
            Sent to office ({sent.length})
          </summary>
          <ul className="flex flex-col gap-2 p-2">
            {sent.map((entry) => (
              <EntryRow
                key={entry.idempotencyKey}
                entry={entry}
                businessDate={businessDate}
              />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <Button tone="secondary" onClick={() => openView("#handover")}>
          <Money aria-hidden size={20} weight="regular" />
          Hand over cash
        </Button>
        {signOutBlocked ? (
          <FormMessage tone="critical">
            {summary?.unsynced}{" "}
            {summary?.unsynced === 1 ? "collection is" : "collections are"}{" "}
            still on this phone. Send them before signing out.
          </FormMessage>
        ) : null}
        <Button tone="ghost" onClick={onSignOut}>
          <SignOut aria-hidden size={20} weight="regular" />
          Sign out
        </Button>
      </div>

      {removing ? (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title={`Remove ${formatCurrency(removing.payload.amount)} from ${removing.customerName}`}
          description={`The office did not accept this collection (${removing.lastError?.message ?? "refused"}). Hand the money to the office yourself; removing it takes it off this phone for good.`}
        >
          <DialogActions>
            <Button tone="secondary" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                const entry = removing;
                setRemoving(null);
                void onRemoveRefused(entry);
              }}
            >
              I will hand it in — remove
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </div>
  );
}

function EntryRow({
  entry,
  businessDate,
  children,
}: {
  entry: OutboxEntry;
  businessDate: string;
  children?: React.ReactNode;
}) {
  const captured = `${entry.businessDate === businessDate ? "" : `${formatBusinessDate(entry.businessDate)}, `}${formatClockTime(entry.capturedAt)}`;
  return (
    <li
      className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-[var(--row-padding-y)]"
      data-testid="outbox-entry"
      data-status={entry.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-medium text-ink">
            {entry.customerName}
          </span>
          <span className="text-xs text-ink-muted">
            {entry.accountCode} · captured {captured}
          </span>
        </div>
        <span
          className="shrink-0 text-base font-semibold text-ink"
          data-numeric
        >
          {entry.payload.amount === "0"
            ? "No payment"
            : formatCurrency(entry.payload.amount)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EntryStateMark entry={entry} />
        {children}
      </div>
      {entry.status === "FAILED" && entry.lastError ? (
        <p className="text-sm text-critical">{entry.lastError.message}</p>
      ) : null}
      {entry.status !== "SYNCED" && entry.attempts > 0 ? (
        <details className="text-xs text-ink-muted">
          <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center">
            Details
          </summary>
          <p className="pt-1" data-numeric>
            Tried {entry.attempts} {entry.attempts === 1 ? "time" : "times"}
            {entry.lastError && entry.status !== "FAILED"
              ? ` · last problem: ${entry.lastError.message}`
              : ""}
          </p>
          {entry.payload.note ? <p>Note: {entry.payload.note}</p> : null}
          <p>Reference {entry.idempotencyKey.slice(0, 8)}</p>
        </details>
      ) : null}
    </li>
  );
}
