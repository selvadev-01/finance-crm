"use client";

import {
  CaretRight,
  CheckCircle,
  CloudSlash,
  MagnifyingGlass,
  UsersThree,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { customerContract, type LinePortfolio } from "@repo/contracts";
import { Badge, cn, formatCurrency, Skeleton } from "@repo/ui";
import { useCallback, useDeferredValue, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { fieldDb } from "../../lib/offline/client";
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";
import { openView } from "./hash-view";
import { useLazyCount } from "./lazy-list";
import { formatClockTime, initials } from "./sync-marks";

type Customer = LinePortfolio["customers"][number];
type Filter = "all" | "due" | "overdue" | "completed";

/** The last portfolio read, kept on the phone for no signal. Cleared at sign-out. */
const PORTFOLIO_KEY = "portfolio";
interface Kept {
  lineId: string;
  fetchedAt: number;
  body: LinePortfolio;
}

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ["all", "All"],
  ["due", "Due today"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
];

/**
 * J-09 · Customers — the Junior's line as a portfolio (2026-09-22): every
 * customer in visiting order (US-040) with what they owe and how their
 * accounts stand, not only the ones due today. **No invested amount or
 * profit** — the API has nowhere to carry them.
 *
 * Read from the office and kept on the phone: with no signal the last copy is
 * shown with when it was fetched, as the route is. Tapping a customer opens
 * their portfolio (J-10).
 */
export function CustomersScreen({
  lineId,
  connected,
}: {
  lineId: string | null;
  connected: boolean;
}) {
  const [kept, setKept] = useState<Kept | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());

  const load = useCallback(async () => {
    if (!lineId) return;
    const db = await fieldDb();
    const stored = (await db.get("meta", PORTFOLIO_KEY))?.value as
      Kept | undefined;
    if (stored?.lineId === lineId) setKept(stored);
    try {
      const result = await api(customerContract.getLinePortfolio, {
        params: { lineId },
      });
      if (!result.ok) {
        setProblem("Could not load your customers. Try again.");
        return;
      }
      const fresh: Kept = { lineId, fetchedAt: Date.now(), body: result.body };
      await db.put("meta", { key: PORTFOLIO_KEY, value: fresh });
      setKept(fresh);
      setProblem(null);
    } catch {
      // No signal: the phone's copy stands.
    }
  }, [lineId]);

  useEffect(() => {
    // Reading the portfolio is the external read this effect synchronises with.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  const portfolio = kept?.body ?? null;
  const customers = portfolio?.customers ?? [];
  const counts: Record<Filter, number> = {
    all: customers.length,
    due: customers.filter((row) => row.dueToday && !row.paidToday).length,
    overdue: customers.filter((row) => row.overdue).length,
    completed: customers.filter(completed).length,
  };
  const shown = customers.filter(
    (row) =>
      (filter === "all" ||
        (filter === "due" && row.dueToday && !row.paidToday) ||
        (filter === "overdue" && row.overdue) ||
        (filter === "completed" && completed(row))) &&
      (search === "" ||
        [row.name, row.customerCode, row.address, row.mobile].some((text) =>
          text.toLowerCase().includes(search),
        )),
  );
  // A line of a hundred customers is drawn twenty at a time as it scrolls.
  const lazy = useLazyCount(shown.length, `${filter}|${search}`);

  return (
    <FieldPage
      title="Customers"
      subtitle={
        portfolio ? `${customers.length} on your line` : "Your line’s customers"
      }
      testId="customers"
    >
      {!lineId ? (
        <Banner tone="neutral" icon={<UsersThree size={20} weight="regular" />}>
          You have no line today, so there are no customers to show. Ask your
          Senior or an Admin.
        </Banner>
      ) : null}
      {lineId && !connected && !kept ? (
        <Banner tone="neutral" icon={<CloudSlash size={20} weight="regular" />}>
          Connect once to load your customers. They stay on this phone after
          that.
        </Banner>
      ) : null}
      {problem && connected ? (
        <Banner
          tone="critical"
          icon={<CloudSlash size={20} weight="regular" />}
        >
          {problem}
        </Banner>
      ) : null}

      {lineId && !portfolio && connected && !problem ? (
        <div
          role="status"
          aria-label="Loading your customers"
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-32 rounded-overlay" />
          <Skeleton className="h-20 rounded-overlay" />
          <Skeleton className="h-20 rounded-overlay" />
        </div>
      ) : null}

      {portfolio ? (
        <>
          <dl
            className={cn(
              cardClass,
              "grid grid-cols-2 gap-px overflow-hidden bg-border",
            )}
            data-numeric
          >
            <Tile
              label="Outstanding"
              value={formatCurrency(portfolio.totals.outstandingTotal)}
              hint="active accounts"
            />
            <Tile
              label="Active accounts"
              value={String(portfolio.totals.activeAccounts)}
            />
            <Tile
              label="Overdue"
              value={String(portfolio.totals.overdueCustomers)}
              hint="customers"
              tone={
                portfolio.totals.overdueCustomers > 0 ? "critical" : "plain"
              }
            />
            <Tile
              label="Collected"
              value={formatCurrency(portfolio.totals.collectedLastSevenDays)}
              hint="last 7 days"
            />
          </dl>

          <label className="relative flex items-center">
            <span className="sr-only">Search your customers</span>
            <MagnifyingGlass
              aria-hidden
              size={20}
              weight="regular"
              className="pointer-events-none absolute left-4 text-ink-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, code, street or mobile"
              enterKeyHint="search"
              className="h-14 w-full rounded-pill border border-border bg-surface-raised pr-12 pl-12 text-base text-ink shadow-raised placeholder:text-ink-subtle focus:outline-2 focus:outline-accent [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1 flex size-12 items-center justify-center rounded-pill text-ink-muted"
              >
                <X aria-hidden size={18} weight="regular" />
              </button>
            ) : null}
          </label>

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
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-4 text-sm font-medium text-ink-muted aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent"
              >
                {label}
                <span data-numeric className="text-xs">
                  {counts[value]}
                </span>
              </button>
            ))}
          </div>

          <Section
            title={`In visiting order · ${shown.length}`}
            aside={
              !connected && kept
                ? `Phone copy from ${formatClockTime(kept.fetchedAt)}`
                : undefined
            }
          >
            {shown.length === 0 ? (
              <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
                {search
                  ? `No customer matches “${query.trim()}”.`
                  : "No customers here."}
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {shown.slice(0, lazy.count).map((row) => (
                    <li key={row.customerId}>
                      <CustomerCard row={row} />
                    </li>
                  ))}
                </ul>
                {lazy.more}
              </>
            )}
          </Section>
        </>
      ) : null}
    </FieldPage>
  );
}

/** Every account closed and nothing left to collect. */
function completed(row: Customer): boolean {
  return row.activeAccounts === 0 && row.completedAccounts > 0;
}

function CustomerCard({ row }: { row: Customer }) {
  return (
    <a
      href={`#customer/${row.customerId}`}
      onClick={(event) => {
        event.preventDefault();
        openView(`#customer/${row.customerId}`);
      }}
      className={cn(
        cardClass,
        "flex flex-col gap-2 px-4 py-3 active:bg-surface-sunken",
        completed(row) && "bg-surface-sunken",
      )}
      data-testid={`portfolio-${row.customerCode}`}
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-pill text-sm font-semibold",
            row.overdue
              ? "bg-critical-subtle text-critical"
              : "bg-accent-subtle text-accent",
          )}
        >
          {initials(row.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold text-ink">
            {row.name}
          </span>
          <span className="truncate text-xs text-ink-muted" data-numeric>
            <span className="font-mono">{row.customerCode}</span> ·{" "}
            {row.address}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end" data-numeric>
          <span className="text-lg font-semibold text-ink">
            {formatCurrency(row.outstandingTotal)}
          </span>
          <span className="text-2xs text-ink-muted">
            {row.activeAccounts === 1
              ? "1 account"
              : `${row.activeAccounts} accounts`}
          </span>
        </span>
        <CaretRight
          aria-hidden
          size={18}
          weight="regular"
          className="shrink-0 text-ink-subtle"
        />
      </span>
      <Marks row={row} />
    </a>
  );
}

/** What stands out about a customer today, most urgent first. */
function Marks({ row }: { row: Customer }) {
  const marks = [
    row.overdue ? (
      <Badge key="overdue" tone="critical" shape="pill">
        Overdue
      </Badge>
    ) : null,
    row.missedDays > 0 ? (
      <Badge key="missed" tone="warning" shape="pill">
        Missed {row.missedDays} {row.missedDays === 1 ? "day" : "days"}
      </Badge>
    ) : null,
    row.paidToday ? (
      <Badge key="paid" tone="positive" shape="pill" mark="none">
        <CheckCircle aria-hidden size={12} weight="fill" />
        Paid today
      </Badge>
    ) : row.dueToday ? (
      <Badge key="due" tone="neutral" shape="pill">
        Due today
      </Badge>
    ) : null,
    completed(row) ? (
      <Badge key="done" tone="neutral" shape="pill">
        Completed
      </Badge>
    ) : null,
  ].filter(Boolean);
  if (marks.length === 0) return null;
  return <span className="flex flex-wrap gap-1.5 pl-14">{marks}</span>;
}

function Tile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "critical";
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "text-xl font-semibold",
          tone === "critical" ? "text-critical" : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-xs text-ink-muted">{hint}</dd> : null}
    </div>
  );
}
