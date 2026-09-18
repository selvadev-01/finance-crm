import {
  CaretDown,
  CheckCircle,
  Money,
  SignOut,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  cn,
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
import { openView } from "./hash-view";
import { BackToRoute, EntryStateMark, formatClockTime } from "./sync-marks";

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
      <BackToRoute />
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tracking-tight text-ink">Sync</p>
        <p className="text-sm text-ink-muted">
          What is on this phone and what has reached the office
        </p>
      </div>

      {unsent.length === 0 ? (
        <div
          className="flex items-center gap-3 rounded-surface border border-border bg-surface-raised p-4 shadow-raised"
          data-testid="all-synced"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-positive-border bg-positive-subtle">
            <CheckCircle
              aria-hidden
              size={24}
              weight="fill"
              className="text-positive"
            />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-lg font-semibold text-ink">
              Everything is sent to the office
            </h1>
            <p className="text-sm text-ink-muted">{lastSent}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--stack-gap)] rounded-surface border border-border bg-surface-raised p-4 shadow-raised">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-warning-border bg-warning-subtle">
              <Warning
                aria-hidden
                size={24}
                weight="regular"
                className="text-warning"
              />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="text-lg font-semibold text-ink" data-numeric>
                {unsent.length === 1
                  ? "1 collection not sent"
                  : `${unsent.length} collections not sent`}
              </h1>
              <p className="text-sm text-ink-muted">{lastSent}</p>
            </div>
          </div>
          {!connected ? (
            <FormMessage tone="info">
              No signal. They are safe on this phone and send by themselves when
              signal returns.
            </FormMessage>
          ) : null}
          <Button
            tone="primary"
            onClick={onSendNow}
            disabled={sending}
            className="h-13 w-full text-lg font-semibold"
          >
            <UploadSimple
              aria-hidden
              size={20}
              weight="regular"
              className={sending ? "animate-pulse" : undefined}
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
        <section className="flex flex-col gap-2">
          <h2
            className="text-xs font-semibold tracking-wide text-ink-muted uppercase"
            data-numeric
          >
            On this phone · {unsent.length}
          </h2>
          <ul
            className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-surface-raised shadow-raised"
            data-testid="outbox"
          >
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
        </section>
      ) : null}

      {sent.length > 0 ? (
        <details className="group overflow-hidden rounded-surface border border-border bg-surface-raised shadow-raised">
          <summary className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
            <CheckCircle
              aria-hidden
              size={20}
              weight="fill"
              className="shrink-0 text-positive"
            />
            <span className="flex-1">
              Sent to office{" "}
              <span className="text-ink-muted" data-numeric>
                ({sent.length})
              </span>
            </span>
            <CaretDown
              aria-hidden
              size={18}
              weight="regular"
              className="shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
            />
          </summary>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
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

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        <Button
          tone="secondary"
          onClick={() => openView("#handover")}
          className="w-full"
        >
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
        <Button tone="ghost" onClick={onSignOut} className="w-full">
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
      className={cn(
        "flex flex-col gap-2 px-4 py-[var(--row-padding-y)]",
        entry.status === "FAILED" && "bg-critical-subtle",
      )}
      data-testid="outbox-entry"
      data-status={entry.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-semibold text-ink">
            {entry.customerName}
          </span>
          <span className="text-xs text-ink-muted" data-numeric>
            <span className="font-mono">{entry.accountCode}</span> · captured{" "}
            {captured}
          </span>
        </div>
        <span className="shrink-0 text-xl font-semibold text-ink" data-numeric>
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
        <p className="rounded-control border border-critical-border bg-surface-raised px-3 py-2 text-sm font-medium text-critical">
          {entry.lastError.message}
        </p>
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
