"use client";

import {
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  CloudSlash,
  Wallet,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  cn,
  Dialog,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";
import { useState } from "react";

import type { OutboxEntry } from "../../lib/offline/db";
import { cardClass, FieldPage, Section } from "./app-chrome";
import { switchTab } from "./hash-view";
import { useLazyCount } from "./lazy-list";
import { EntryStateMark, formatClockTime } from "./sync-marks";

/**
 * J-04 · Sync (S-03, US-054) — "is my day safe". Everything not yet sent,
 * with when it was captured, how often it was tried and why it last failed. A
 * refused collection cannot be retried into success: the Junior removes it
 * only after confirming they will hand the money to the office (decision
 * 2026-09-14). The expired-sign-in and full-phone banners come from the shell.
 */
export function SyncScreen({
  entries,
  lastSync,
  businessDate,
  connected,
  sending,
  onSendNow,
  onRetry,
  onRemoveRefused,
}: {
  entries: OutboxEntry[];
  lastSync: string | null;
  businessDate: string;
  connected: boolean;
  sending: boolean;
  onSendNow: () => void;
  onRetry: (entry: OutboxEntry) => void;
  onRemoveRefused: (entry: OutboxEntry) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<OutboxEntry | null>(null);
  const unsent = entries.filter((entry) => entry.status !== "SYNCED");
  const sent = entries.filter((entry) => entry.status === "SYNCED").reverse();
  // The day's sent entries are drawn a piece at a time. What is still on the
  // phone is always shown in full — "is my day safe" hides nothing.
  const lazySent = useLazyCount(sent.length, "sent");
  const lastSent = lastSync
    ? `Last sent ${formatClockTime(lastSync)}`
    : "Nothing sent from this phone yet";

  return (
    <FieldPage back title="Sync" testId="sync">
      <p className="px-1 text-sm text-ink-muted">
        What is on this phone and what has reached the office.
      </p>
      {unsent.length === 0 ? (
        <div
          className={cn(cardClass, "flex items-center gap-4 p-4")}
          data-testid="all-synced"
        >
          <StatusTile tone="positive">
            <CheckCircle size={28} weight="fill" />
          </StatusTile>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-ink">
              Everything is sent to the office
            </h2>
            <p className="text-sm text-ink-muted">{lastSent}</p>
          </div>
        </div>
      ) : (
        <div className={cn(cardClass, "flex flex-col gap-4 p-4")}>
          <div className="flex items-center gap-4">
            <StatusTile tone="warning">
              {connected ? (
                <Warning size={28} weight="regular" />
              ) : (
                <CloudSlash size={28} weight="regular" />
              )}
            </StatusTile>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-ink" data-numeric>
                {unsent.length === 1
                  ? "1 collection not sent"
                  : `${unsent.length} collections not sent`}
              </h2>
              <p className="text-sm text-ink-muted">{lastSent}</p>
            </div>
          </div>
          {!connected ? (
            <p className="rounded-surface bg-surface-sunken px-3 py-2.5 text-sm text-ink-muted">
              No signal. They are safe on this phone and send by themselves when
              signal returns.
            </p>
          ) : null}
          <Button
            tone="primary"
            onClick={onSendNow}
            disabled={sending}
            className="h-14 w-full rounded-pill text-lg font-semibold"
          >
            <ArrowsClockwise
              aria-hidden
              size={22}
              weight="regular"
              className={sending ? "animate-spin" : undefined}
            />
            Send now
          </Button>
        </div>
      )}

      {unsent.length > 0 ? (
        <Section title={`On this phone · ${unsent.length}`}>
          <ul className="flex flex-col gap-2" data-testid="outbox">
            {unsent.map((entry) => (
              <EntryRow
                key={entry.idempotencyKey}
                entry={entry}
                businessDate={businessDate}
                onRemove={() => setRemoving(entry)}
              >
                {entry.status === "QUEUED" ? (
                  <Button
                    tone="ghost"
                    onClick={() => onRetry(entry)}
                    disabled={sending}
                    className="-mr-2 rounded-pill font-semibold text-accent"
                  >
                    <ArrowsClockwise aria-hidden size={18} weight="regular" />
                    Retry
                  </Button>
                ) : null}
              </EntryRow>
            ))}
          </ul>
        </Section>
      ) : null}

      {sent.length > 0 ? (
        <details className={cn(cardClass, "group overflow-hidden")}>
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
            <CheckCircle
              aria-hidden
              size={22}
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
            {sent.slice(0, lazySent.count).map((entry) => (
              <EntryRow
                key={entry.idempotencyKey}
                entry={entry}
                businessDate={businessDate}
                flat
              />
            ))}
          </ul>
          <div className="px-4 pb-3">{lazySent.more}</div>
        </details>
      ) : null}

      <Button
        tone="secondary"
        onClick={() => switchTab("handover")}
        className="mt-2 h-12 w-full rounded-pill"
      >
        <Wallet aria-hidden size={20} weight="regular" />
        Hand over cash
      </Button>

      {removing ? (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          placement="sheet"
          title={`Remove ${formatCurrency(removing.payload.amount)} from ${removing.customerName}`}
          description={`The office did not accept this collection (${removing.lastError?.message ?? "refused"}). Hand the money to the office yourself; removing it takes it off this phone for good.`}
        >
          <p
            className="rounded-surface bg-surface-sunken px-4 py-3 text-sm text-ink-muted"
            data-numeric
          >
            <span className="font-mono">{removing.accountCode}</span> · captured{" "}
            {formatClockTime(removing.capturedAt)} ·{" "}
            <span className="font-semibold text-ink">
              {formatCurrency(removing.payload.amount)}
            </span>
          </p>
          <div className="flex flex-col gap-2 pb-2">
            <Button
              tone="danger"
              onClick={() => {
                const entry = removing;
                setRemoving(null);
                void onRemoveRefused(entry);
              }}
              className="h-14 rounded-pill text-base font-semibold"
            >
              I will hand it in — remove
            </Button>
            <Button
              tone="ghost"
              onClick={() => setRemoving(null)}
              className="h-12 rounded-pill"
            >
              Keep it
            </Button>
          </div>
        </Dialog>
      ) : null}
    </FieldPage>
  );
}

function StatusTile({
  tone,
  children,
}: {
  tone: "positive" | "warning";
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-surface border",
        tone === "positive"
          ? "border-positive-border bg-positive-subtle text-positive"
          : "border-warning-border bg-warning-subtle text-warning",
      )}
    >
      {children}
    </span>
  );
}

function EntryRow({
  entry,
  businessDate,
  flat = false,
  onRemove,
  children,
}: {
  entry: OutboxEntry;
  businessDate: string;
  /** Inside the "Sent to office" list: rows, not cards. */
  flat?: boolean;
  /** A refused entry's one way out (US-054). */
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  const captured = `${entry.businessDate === businessDate ? "" : `${formatBusinessDate(entry.businessDate)}, `}${formatClockTime(entry.capturedAt)}`;
  const failed = entry.status === "FAILED";
  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-4 py-3",
        !flat && cardClass,
        failed && "border-critical-border bg-critical-subtle",
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
        <span className="shrink-0 text-lg font-semibold text-ink" data-numeric>
          {entry.payload.amount === "0"
            ? "No payment"
            : formatCurrency(entry.payload.amount)}
        </span>
      </div>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <EntryStateMark entry={entry} />
        {children}
      </div>
      {failed && entry.lastError ? (
        <p className="flex items-start gap-2 rounded-surface border border-critical-border bg-surface-raised px-3 py-2 text-sm font-medium text-critical">
          <WarningCircle
            aria-hidden
            size={18}
            weight="regular"
            className="mt-px shrink-0"
          />
          {entry.lastError.message}
        </p>
      ) : null}
      {failed && onRemove ? (
        <Button
          tone="secondary"
          onClick={onRemove}
          className="h-12 w-full rounded-pill border-critical-border text-critical shadow-none hover:bg-surface-raised hover:text-critical"
        >
          Hand in and remove
        </Button>
      ) : null}
      {entry.status !== "SYNCED" && entry.attempts > 0 ? (
        <details className="text-xs text-ink-muted">
          <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center">
            Details
          </summary>
          <p className="pt-1" data-numeric>
            Tried {entry.attempts} {entry.attempts === 1 ? "time" : "times"}
            {entry.lastError && !failed
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
