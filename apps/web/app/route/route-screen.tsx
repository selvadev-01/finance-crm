"use client";

import {
  ArrowClockwise,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  CloudArrowDown,
  MagnifyingGlass,
  Sun,
  Wallet,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import {
  Button,
  cn,
  formatBusinessDate,
  formatCurrency,
  Meter,
} from "@repo/ui";
import { use, useDeferredValue, useState } from "react";

import { sumMoney } from "../../lib/money";
import type { LocalRoute, RowState } from "../../lib/offline/outbox";
import { cardClass, FieldChrome, FieldPage, Section } from "./app-chrome";
import { openView, switchTab } from "./hash-view";
import { useLazyCount } from "./lazy-list";
import {
  ClassificationMark,
  formatClockTime,
  initials,
  RowStateMark,
} from "./sync-marks";

type Customer = RouteView["customers"][number];
type Account = Customer["accounts"][number];
type Filter = "all" | "left" | "done";

/**
 * J-01 · Today's route (S-01, US-040). Who to visit and what to ask for, with
 * each row's sync state; tapping a customer opens J-02. The progress card is
 * the Junior's own day — visits, what they have collected, what is still on
 * the phone. **No invested amount or profit**: the route payload has nowhere
 * to carry them.
 *
 * "All" is the default, with customers still to visit first: a recorded
 * customer drops to the "Done" group rather than vanishing from the list.
 */
export function RouteScreen({
  local,
  businessDate,
  connected,
  unsynced,
  refreshing,
  onRefresh,
}: {
  local: LocalRoute | null;
  businessDate: string;
  connected: boolean;
  unsynced: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const chrome = use(FieldChrome);
  const customers = local?.route.customers ?? [];

  return (
    <FieldPage
      title="Today’s route"
      subtitle={formatBusinessDate(businessDate)}
      actions={
        <>
          {/* With no signal a refresh can only fail; the room goes to the title. */}
          {connected ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh route"
              className="flex size-12 items-center justify-center rounded-pill text-ink-muted hover:bg-surface-sunken disabled:opacity-60"
            >
              <ArrowClockwise
                aria-hidden
                size={22}
                weight="regular"
                className={cn(refreshing && "animate-spin")}
              />
            </button>
          ) : null}
          {chrome.actions}
        </>
      }
    >
      {!local ? (
        <DayMessage
          testId="no-route"
          icon={<CloudArrowDown size={28} weight="regular" />}
          title="Today’s route is not on this phone yet"
        >
          Connect once to load today’s route. It stays on this phone after that.
        </DayMessage>
      ) : local.route.day.kind === "SUNDAY" ? (
        <DayMessage
          testId="empty-route"
          icon={<Sun size={28} weight="regular" />}
          title="No collections on Sundays"
        >
          Enjoy the day. Your route comes back tomorrow.
        </DayMessage>
      ) : local.route.day.kind === "HOLIDAY" ? (
        <DayMessage
          testId="empty-route"
          icon={<CalendarBlank size={28} weight="regular" />}
          title={`Today is a holiday: ${local.route.day.name}`}
        >
          No collections are due today.
        </DayMessage>
      ) : customers.length === 0 ? (
        <DayMessage
          testId="empty-route"
          icon={<CalendarBlank size={28} weight="regular" />}
          title="No collections due today"
        >
          {local.route.lineId === null
            ? "You have no line today. Ask your Senior or an Admin."
            : "Nobody on your line has a payment due today."}
        </DayMessage>
      ) : (
        <WorkingDay local={local} unsynced={unsynced} />
      )}
      {local ? (
        <p
          className="px-1 text-center text-xs text-ink-muted"
          data-testid="route-fetched"
        >
          {connected ? "Updated" : "Phone copy from"}{" "}
          {formatClockTime(local.fetchedAt)}
          {local.optimistic ? " · includes collections not yet sent" : ""}
        </p>
      ) : null}
    </FieldPage>
  );
}

function WorkingDay({
  local,
  unsynced,
}: {
  local: LocalRoute;
  unsynced: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const customers = local.route.customers;
  const pending = (customer: Customer) =>
    customer.accounts.some(
      (account) => local.rowState[account.accountLoanId] === "PENDING",
    );
  const left = customers.filter(pending);
  const done = customers.filter((customer) => !pending(customer));
  const collected = sumMoney(
    customers.flatMap((customer) =>
      customer.accounts.flatMap((account) =>
        account.collectedToday ? [account.collectedToday.amount] : [],
      ),
    ),
  );
  const matches = (customer: Customer) =>
    search === "" ||
    [
      customer.name,
      customer.customerCode,
      customer.address,
      ...customer.accounts.map((account) => account.accountCode),
    ].some((text) => text.toLowerCase().includes(search));
  const shownLeft = filter === "done" ? [] : left.filter(matches);
  const shownDone = filter === "left" ? [] : done.filter(matches);
  // Drawn a piece at a time as the Junior scrolls: those to visit first,
  // then the done group, in the one page scroll.
  const lazy = useLazyCount(
    shownLeft.length + shownDone.length,
    `${filter}|${search}`,
  );
  const visibleLeft = shownLeft.slice(0, lazy.count);
  const visibleDone = shownDone.slice(
    0,
    Math.max(0, lazy.count - shownLeft.length),
  );
  const line = local.route.line ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="route">
      <div className={cn(cardClass, "flex flex-col gap-3 p-4")} data-numeric>
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">
            Today’s progress
          </p>
          {line ? (
            <p className="truncate text-xs text-ink-muted">
              <span className="font-mono">{line.code}</span> · {line.name}
            </p>
          ) : null}
        </div>
        <p className="text-2xl font-semibold tracking-tight text-ink">
          {done.length} of {customers.length} visited
        </p>
        <Meter
          value={Math.floor((done.length * 1000) / customers.length)}
          label="Customers visited"
          valueText={`${done.length} of ${customers.length}`}
          className="h-2.5"
        />
        <dl className="grid grid-cols-3 divide-x divide-border border-t border-border pt-3">
          <Figure label="Collected" value={formatCurrency(collected)} />
          <Figure label="To visit" value={String(left.length)} />
          <Figure
            label="Not sent"
            value={String(unsynced)}
            tone={unsynced > 0 ? "warning" : "plain"}
          />
        </dl>
      </div>

      <label className="relative flex items-center">
        <span className="sr-only">Search the route</span>
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
          placeholder="Search name, code or street"
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
        className="grid grid-cols-3 rounded-pill border border-border bg-surface-sunken p-1"
      >
        {(
          [
            ["all", "All", customers.length],
            ["left", "To visit", left.length],
            ["done", "Done", done.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-pill text-sm font-medium text-ink-muted aria-pressed:bg-accent aria-pressed:text-accent-ink"
          >
            {label}
            <span
              data-numeric
              className="rounded-pill bg-surface-raised/25 px-1.5 text-xs"
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {shownLeft.length === 0 && shownDone.length === 0 ? (
        <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
          {search
            ? `Nobody on today’s route matches “${query.trim()}”.`
            : filter === "done"
              ? "Nobody visited yet."
              : "Everyone on the route is visited."}
        </p>
      ) : null}

      {visibleLeft.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {visibleLeft.map((customer) => (
            <li key={customer.customerId}>
              <CustomerCard customer={customer} local={local} />
            </li>
          ))}
        </ul>
      ) : null}

      {left.length === 0 && filter !== "done" && !search ? (
        <div
          className={cn(
            cardClass,
            "flex flex-col gap-3 border-positive-border bg-positive-subtle p-4",
          )}
        >
          <p className="flex items-center gap-2 text-base font-semibold text-ink">
            <CheckCircle
              aria-hidden
              size={22}
              weight="fill"
              className="text-positive"
            />
            Everyone on the route is visited.
          </p>
          <Button
            tone="primary"
            onClick={() => switchTab("handover")}
            className="h-12 rounded-pill"
          >
            <Wallet aria-hidden size={20} weight="regular" />
            Hand over today’s cash
          </Button>
        </div>
      ) : null}

      {visibleDone.length > 0 ? (
        <Section title={`Done · ${shownDone.length}`}>
          <ul className="flex flex-col gap-3">
            {visibleDone.map((customer) => (
              <li key={customer.customerId}>
                <CustomerCard customer={customer} local={local} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {lazy.more}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "warning";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2 first:pl-0">
      <dt
        className={cn(
          "flex items-center gap-1 text-xs",
          tone === "warning" ? "font-medium text-warning" : "text-ink-muted",
        )}
      >
        {tone === "warning" ? (
          <span
            aria-hidden
            className="size-1.5 rounded-pill bg-warning-bright"
          />
        ) : null}
        {label}
      </dt>
      <dd
        className={cn(
          "truncate text-lg font-semibold",
          tone === "warning" ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function DayMessage({
  testId,
  icon,
  title,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        cardClass,
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
      )}
      data-testid={testId}
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-pill bg-accent-subtle text-accent"
      >
        {icon}
      </span>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-base text-ink-muted">{children}</p>
    </div>
  );
}

/**
 * One tappable card per customer. A customer with several accounts is a group:
 * a header, then one row per account with its own expected amount — visibly
 * different from the single-account card, so a combined payment is not put
 * against the first account (BR-01a, S-01).
 */
function CustomerCard({
  customer,
  local,
}: {
  customer: Customer;
  local: LocalRoute;
}) {
  const grouped = customer.accounts.length > 1;
  const states = customer.accounts.map(
    (account) => local.rowState[account.accountLoanId] ?? "PENDING",
  );
  const done = states.every((state) => state !== "PENDING");

  return (
    <a
      href={`#collect/${customer.customerId}`}
      onClick={(event) => {
        event.preventDefault();
        openView(`#collect/${customer.customerId}`);
      }}
      className={cn(
        "flex flex-col overflow-hidden rounded-overlay border text-left shadow-raised transition-colors active:bg-surface-sunken",
        grouped ? "border-border-strong" : "border-border",
        done ? "bg-surface-sunken" : "bg-surface-raised",
      )}
      data-testid={`customer-${customer.customerCode}`}
    >
      {grouped ? (
        <>
          <span className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Avatar name={customer.name} done={done} />
            <span className="flex min-w-0 flex-1 flex-col">
              <CustomerName name={customer.name} done={done} />
              <span className="truncate text-sm text-ink-muted">
                {customer.address}
              </span>
            </span>
            <span className="shrink-0 rounded-pill border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-muted">
              {customer.accounts.length} accounts
            </span>
          </span>
          <span className="flex flex-col divide-y divide-border">
            {customer.accounts.map((account) => (
              <AccountRow
                key={account.accountLoanId}
                account={account}
                state={local.rowState[account.accountLoanId] ?? "PENDING"}
                className="py-3 pr-3 pl-[4.25rem]"
              >
                <span
                  className="truncate font-mono text-sm font-medium text-ink"
                  data-numeric
                >
                  {account.accountCode}
                </span>
              </AccountRow>
            ))}
          </span>
        </>
      ) : (
        customer.accounts.map((account) => (
          <AccountRow
            key={account.accountLoanId}
            account={account}
            state={local.rowState[account.accountLoanId] ?? "PENDING"}
            className="py-3.5 pr-3 pl-4"
            avatar={<Avatar name={customer.name} done={done} />}
          >
            <CustomerName name={customer.name} done={done} />
            <span className="truncate text-sm text-ink-muted">
              {customer.address}
            </span>
          </AccountRow>
        ))
      )}
    </a>
  );
}

function AccountRow({
  account,
  state,
  className,
  avatar,
  children,
}: {
  account: Account;
  state: RowState;
  className: string;
  avatar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn("flex min-h-touch items-center gap-3", className)}
      data-testid={`account-${account.accountCode}`}
      data-state={state}
    >
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {children}
        <span className="truncate text-xs text-ink-muted" data-numeric>
          Outstanding{" "}
          <span data-testid="outstanding">
            {formatCurrency(account.outstandingAmount)}
          </span>
        </span>
        {state !== "PENDING" || account.collectedToday ? (
          <span className="mt-1 flex flex-wrap gap-1.5">
            <RowStateMark state={state} />
            {account.collectedToday &&
            account.collectedToday.classification !== "CORRECT" ? (
              <ClassificationMark
                classification={account.collectedToday.classification}
              />
            ) : null}
          </span>
        ) : null}
      </span>
      <Amount account={account} />
      <CaretRight
        aria-hidden
        size={18}
        weight="regular"
        className="shrink-0 text-ink-subtle"
      />
    </span>
  );
}

function Avatar({ name, done }: { name: string; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-pill text-sm font-semibold",
        done
          ? "bg-positive-subtle text-positive"
          : "bg-accent-subtle text-accent",
      )}
    >
      {done ? <CheckCircle size={22} weight="fill" /> : initials(name)}
    </span>
  );
}

function CustomerName({ name, done }: { name: string; done: boolean }) {
  return (
    <span
      className={cn(
        "truncate text-base font-semibold",
        done ? "text-ink-muted" : "text-ink",
      )}
    >
      {name}
    </span>
  );
}

function Amount({ account }: { account: Account }) {
  return account.collectedToday ? (
    <span
      className="flex shrink-0 flex-col items-end"
      data-testid="collected-today"
      data-numeric
    >
      <span className="text-xs text-ink-muted">Collected</span>
      <span className="text-lg font-semibold text-ink-muted">
        {account.collectedToday.classification === "NO_PAYMENT"
          ? "No payment"
          : formatCurrency(account.collectedToday.amount)}
      </span>
    </span>
  ) : (
    <span className="flex shrink-0 flex-col items-end" data-numeric>
      <span className="text-xl font-semibold text-ink" data-testid="expected">
        {formatCurrency(account.expectedAmount)}
      </span>
      <span className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
        Due today
      </span>
    </span>
  );
}
