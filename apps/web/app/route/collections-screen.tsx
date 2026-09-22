"use client";

import {
  ArrowsClockwise,
  CaretRight,
  PencilSimple,
  Receipt,
} from "@phosphor-icons/react/dist/ssr";
import { cn, formatBusinessDate, formatCurrency } from "@repo/ui";
import { useState } from "react";

import { sumMoney } from "../../lib/money";
import type { OutboxEntry } from "../../lib/offline/db";
import type { LocalRoute, RowState } from "../../lib/offline/outbox";
import { cardClass, FieldPage, Section } from "./app-chrome";
import { EarlierCollections } from "./earlier-collections";
import { openView } from "./hash-view";
import { useLazyCount } from "./lazy-list";
import {
  type Classification,
  ClassificationMark,
  formatClockTime,
  RowStateMark,
} from "./sync-marks";

type Filter = "all" | "unsent" | Classification;

interface Row {
  accountLoanId: string;
  customerId: string;
  customerName: string;
  accountCode: string;
  amount: string;
  classification: Classification;
  state: RowState;
  capturedAt: string | null;
}

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ["all", "All"],
  ["unsent", "Not sent"],
  ["LOW", "Less"],
  ["EXTRA", "More"],
  ["NO_PAYMENT", "No payment"],
];

/**
 * J-03 · Today's collections (US-045 on the phone). What the Junior has
 * recorded today, each with what it was against the expected amount and
 * whether it has reached the office. Built from what is on the phone — the
 * route with its local collections applied, and the outbox for the capture
 * time — so it opens with no signal. A figure entered wrongly is corrected by
 * asking (US-044), never by editing (BR-14).
 */
export function CollectionsScreen({
  local,
  entries,
  businessDate,
  unsynced,
  connected,
}: {
  local: LocalRoute | null;
  entries: OutboxEntry[];
  businessDate: string;
  unsynced: number;
  connected: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = todaysRows(local, entries, businessDate);
  const shown = rows.filter((row) =>
    filter === "all"
      ? true
      : filter === "unsent"
        ? row.state === "SAVED" || row.state === "SYNCING"
        : row.classification === filter,
  );
  const noPayment = rows.filter(
    (row) => row.classification === "NO_PAYMENT",
  ).length;
  // A day's collections are drawn twenty at a time as the list scrolls.
  const lazy = useLazyCount(shown.length, filter);

  return (
    <FieldPage
      title="Collections"
      subtitle={formatBusinessDate(businessDate)}
      testId="collections"
    >
      <dl
        className={cn(
          cardClass,
          "grid grid-cols-2 gap-px overflow-hidden bg-border",
        )}
        data-numeric
      >
        <Tile
          label="Collected"
          value={formatCurrency(sumMoney(rows.map((row) => row.amount)))}
        />
        <Tile label="Visits" value={String(rows.length)} />
        <Tile
          label="No payment"
          value={String(noPayment)}
          tone={noPayment > 0 ? "critical" : "plain"}
        />
        <Tile
          label="Not sent"
          value={String(unsynced)}
          tone={unsynced > 0 ? "warning" : "plain"}
        />
      </dl>

      <div
        role="group"
        aria-label="Show"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
      >
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="flex h-11 shrink-0 items-center rounded-pill border border-border-strong bg-surface-raised px-4 text-sm font-medium text-ink-muted aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent"
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div
          className={cn(
            cardClass,
            "flex flex-col items-center gap-3 px-6 py-10 text-center",
          )}
        >
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-pill bg-accent-subtle text-accent"
          >
            <Receipt size={28} weight="regular" />
          </span>
          <p className="text-lg font-semibold text-ink">
            Nothing recorded today yet
          </p>
          <p className="text-base text-ink-muted">
            Each customer you record appears here, with whether it has reached
            the office.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
          None of today’s collections match this filter.
        </p>
      ) : (
        <Section title={`Recorded today · ${shown.length}`}>
          <ul className="flex flex-col gap-2">
            {shown.slice(0, lazy.count).map((row) => (
              <li key={row.accountLoanId}>
                <a
                  href={`#collect/${row.customerId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    openView(`#collect/${row.customerId}`);
                  }}
                  className={cn(
                    cardClass,
                    "flex items-center gap-3 px-4 py-3 active:bg-surface-sunken",
                  )}
                  data-testid={`collection-${row.accountCode}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-base font-semibold text-ink">
                      {row.customerName}
                    </span>
                    <span
                      className="truncate text-xs text-ink-muted"
                      data-numeric
                    >
                      <span className="font-mono">{row.accountCode}</span>
                      {row.capturedAt
                        ? ` · ${formatClockTime(row.capturedAt)}`
                        : ""}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <ClassificationMark classification={row.classification} />
                      <RowStateMark state={row.state} />
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-lg font-semibold text-ink"
                    data-numeric
                  >
                    {row.classification === "NO_PAYMENT"
                      ? "No payment"
                      : formatCurrency(row.amount)}
                  </span>
                  <CaretRight
                    aria-hidden
                    size={18}
                    weight="regular"
                    className="shrink-0 text-ink-subtle"
                  />
                </a>
              </li>
            ))}
          </ul>
          {lazy.more}
        </Section>
      )}

      <EarlierCollections connected={connected} businessDate={businessDate} />

      <div className={cn(cardClass, "flex flex-col divide-y divide-border")}>
        <ListAction
          icon={<ArrowsClockwise size={22} weight="regular" />}
          label="Sync"
          hint="What is on this phone and what has reached the office"
          onClick={() => openView("#sync")}
        />
        <ListAction
          icon={<PencilSimple size={22} weight="regular" />}
          label="Ask to correct a collection"
          hint="Your Senior approves it. Needs signal."
          onClick={() => openView("#correct")}
        />
      </div>
    </FieldPage>
  );
}

/**
 * Today's collections, newest first where the phone knows when: every account
 * on the route with one recorded today, local or from the office.
 */
function todaysRows(
  local: LocalRoute | null,
  entries: OutboxEntry[],
  businessDate: string,
): Row[] {
  if (!local || local.route.businessDate !== businessDate) return [];
  const captured = new Map<string, string>();
  for (const entry of entries) {
    if (entry.businessDate === businessDate && entry.status !== "FAILED")
      captured.set(entry.payload.accountLoanId, entry.capturedAt);
  }
  const rows = local.route.customers.flatMap((customer) =>
    customer.accounts.flatMap((account) =>
      account.collectedToday
        ? [
            {
              accountLoanId: account.accountLoanId,
              customerId: customer.customerId,
              customerName: customer.name,
              accountCode: account.accountCode,
              amount: account.collectedToday.amount,
              classification: account.collectedToday.classification,
              state: local.rowState[account.accountLoanId] ?? "SYNCED",
              capturedAt: captured.get(account.accountLoanId) ?? null,
            },
          ]
        : [],
    ),
  );
  return rows.sort((a, b) =>
    (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""),
  );
}

function Tile({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "warning" | "critical";
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "text-xl font-semibold",
          tone === "plain" && "text-ink",
          tone === "warning" && "text-warning",
          tone === "critical" && "text-critical",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ListAction({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-sunken"
    >
      <span aria-hidden className="shrink-0 text-accent">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </span>
      <CaretRight
        aria-hidden
        size={18}
        weight="regular"
        className="shrink-0 text-ink-subtle"
      />
    </button>
  );
}
