"use client";

import { CaretDown, CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { type CollectionListItem, collectionContract } from "@repo/contracts";
import { addCalendarDays, parseCalendarDate } from "@repo/domain";
import {
  Badge,
  Button,
  cn,
  formatBusinessDate,
  formatCurrency,
  LoadMoreSentinel,
  Skeleton,
} from "@repo/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { absMoney, isNegativeMoney } from "../../lib/money";
import { cardClass, Section } from "./app-chrome";
import { ClassificationMark, formatClockTime } from "./sync-marks";

/** How far back the phone looks. The API allows 93 days; a month is enough at a door. */
const DAYS_BACK = 30;
const PAGE = 50;

/**
 * US-045 on the Junior's phone: their own collections before today, as the
 * office has them — including corrections and whether they were approved.
 * Needs signal: history is not kept on the phone, so nothing here competes
 * with the outbox for storage. `collectionScope` limits a Junior to their own
 * entries (M02); the phone only asks.
 *
 * Today is asked for too, for its corrections only. A correction carries the
 * date it was asked for, not the date of the collection it corrects (US-044),
 * so one a Senior raised this morning on yesterday's entry is dated today —
 * and today's own collections are already listed above, from the phone.
 */
export function EarlierCollections({
  connected,
  businessDate,
}: {
  connected: boolean;
  businessDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CollectionListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // `loading` disables "Show more" only once React renders; two quick taps
  // would both read the same cursor and append the same page twice.
  const inFlight = useRef(false);
  const panelId = useId();

  const load = useCallback(
    async (after: string | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const today = parseCalendarDate(businessDate);
      setLoading(true);
      try {
        const result = await api(collectionContract.listCollections, {
          query: {
            from: addCalendarDays(today, -DAYS_BACK),
            to: businessDate,
            limit: PAGE,
            ...(after ? { cursor: after } : {}),
          },
        });
        if (!result.ok) {
          setProblem("Could not load earlier collections. Try again.");
        } else {
          setRows((previous) => [
            ...(after ? (previous ?? []) : []),
            ...result.body.data,
          ]);
          setCursor(result.body.hasMore ? result.body.nextCursor : null);
          setProblem(null);
        }
      } catch {
        setProblem("No signal. Connect to see earlier days.");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [businessDate],
  );

  useEffect(() => {
    if (!open || !connected || rows !== null) return;
    // Reading the history is the external read this effect synchronises with.
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [open, connected, rows, load]);

  const shown = (rows ?? []).filter(
    (row) =>
      row.businessDate !== businessDate || row.entryType === "ADJUSTMENT",
  );
  const days = groupByDay(shown);

  return (
    <Section title={`Earlier · last ${DAYS_BACK} days`}>
      <div className={cn(cardClass, "overflow-hidden")}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-medium text-ink active:bg-surface-sunken"
        >
          <span className="flex-1">
            {open ? "Hide earlier days" : "Show earlier days"}
          </span>
          <CaretDown
            aria-hidden
            size={18}
            weight="regular"
            className={cn(
              "shrink-0 text-ink-subtle transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <div
            id={panelId}
            className="flex flex-col gap-3 border-t border-border px-4 py-3"
            data-testid="earlier-collections"
          >
            {!connected && rows === null ? (
              <p className="flex items-start gap-2 text-sm text-ink-muted">
                <CloudSlash
                  aria-hidden
                  size={18}
                  weight="regular"
                  className="mt-px shrink-0"
                />
                Connect to see earlier days. Today’s collections are above, on
                this phone.
              </p>
            ) : null}
            {problem ? (
              <p className="text-sm font-medium text-critical">{problem}</p>
            ) : null}
            {rows === null && loading ? (
              <div
                role="status"
                aria-label="Loading earlier collections"
                className="flex flex-col gap-2"
              >
                <Skeleton className="h-12 rounded-surface" />
                <Skeleton className="h-12 rounded-surface" />
              </div>
            ) : null}
            {rows !== null && shown.length === 0 && !cursor ? (
              <p className="text-sm text-ink-muted">
                Nothing recorded in the last {DAYS_BACK} days.
              </p>
            ) : null}
            {days.map(([day, entries]) => (
              <div key={day} className="flex flex-col gap-1">
                <h3 className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
                  {formatBusinessDate(day)}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {entries.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </div>
            ))}
            {cursor ? (
              // The next page loads as the end comes near; after a failure
              // it waits for the button, rather than asking again and again.
              <LoadMoreSentinel
                onMore={() => void load(cursor)}
                busy={loading || problem !== null}
              />
            ) : null}
            {cursor ? (
              <Button
                tone="secondary"
                onClick={() => void load(cursor)}
                disabled={loading}
                className="h-12 w-full rounded-pill"
              >
                {loading ? "Loading…" : "Show more"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function HistoryRow({ entry }: { entry: CollectionListItem }) {
  const adjustment = entry.entryType === "ADJUSTMENT";
  return (
    <li
      className="flex items-start justify-between gap-3 py-2.5"
      data-testid={`history-${entry.id}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-base font-semibold text-ink">
          {entry.customerName}
        </span>
        <span className="truncate text-xs text-ink-muted" data-numeric>
          <span className="font-mono">{entry.accountCode}</span> ·{" "}
          {formatClockTime(entry.capturedAt)}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {adjustment ? (
            <Badge tone="neutral" shape="pill">
              Correction
            </Badge>
          ) : (
            <ClassificationMark classification={entry.classification} />
          )}
          <StatusMark entry={entry} />
        </span>
      </div>
      <span className="shrink-0 text-base font-semibold text-ink" data-numeric>
        {adjustment
          ? `${isNegativeMoney(entry.amount) ? "−" : "+"}${formatCurrency(absMoney(entry.amount))}`
          : entry.classification === "NO_PAYMENT"
            ? "No payment"
            : formatCurrency(entry.amount)}
      </span>
    </li>
  );
}

/** What happened to it at the office; a plain confirmed collection says nothing. */
function StatusMark({ entry }: { entry: CollectionListItem }) {
  switch (entry.status) {
    case "PENDING_APPROVAL":
      return (
        <Badge tone="warning" shape="pill">
          Waiting for approval
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge tone="critical" shape="pill">
          Not approved
        </Badge>
      );
    case "REVERSED":
      return (
        <Badge tone="neutral" shape="pill">
          Reversed
        </Badge>
      );
    case "CONFIRMED":
      return entry.entryType === "ADJUSTMENT" ? (
        <Badge tone="positive" shape="pill">
          Approved
        </Badge>
      ) : null;
  }
}

/** Newest day first, as the API orders them; entries keep their order. */
function groupByDay(
  rows: CollectionListItem[],
): Array<[string, CollectionListItem[]]> {
  const days = new Map<string, CollectionListItem[]>();
  for (const row of rows) {
    const list = days.get(row.businessDate) ?? [];
    list.push(row);
    days.set(row.businessDate, list);
  }
  return [...days.entries()];
}
