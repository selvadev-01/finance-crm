import {
  ArrowClockwise,
  CaretRight,
  Money,
} from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import {
  Badge,
  Button,
  cn,
  formatBusinessDate,
  formatCurrency,
} from "@repo/ui";

import type { LocalRoute } from "../../lib/offline/outbox";
import { openView } from "./hash-view";
import { formatClockTime, RowStateMark } from "./sync-marks";

type Customer = RouteView["customers"][number];
type Account = Customer["accounts"][number];

/**
 * S-01 · Today's route. Read-only: who to visit and what to ask for, with each
 * row's sync state. Tapping a customer opens S-02. **No invested amount or
 * profit** — the route payload has nowhere to carry them.
 */
export function RouteScreen({
  local,
  businessDate,
  name,
  connected,
  refreshing,
  onRefresh,
}: {
  local: LocalRoute | null;
  businessDate: string;
  name: string;
  connected: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const customers = local?.route.customers ?? [];
  const left = customers.filter((customer) =>
    customer.accounts.some(
      (account) => local?.rowState[account.accountLoanId] === "PENDING",
    ),
  ).length;

  return (
    <div className="flex flex-col gap-[var(--stack-gap)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Today’s route
          </h1>
          <p className="text-sm text-ink-muted">
            {formatBusinessDate(businessDate)} · {name}
          </p>
          {local ? (
            <p className="text-sm text-ink-muted" data-testid="route-fetched">
              {connected ? "Updated" : "Phone copy from"}{" "}
              {formatClockTime(local.fetchedAt)}
              {local.optimistic ? " · includes collections not yet sent" : ""}
            </p>
          ) : null}
        </div>
        <Button
          tone="secondary"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh route"
          className="px-3"
        >
          <ArrowClockwise
            aria-hidden
            size={20}
            weight="regular"
            className={cn(refreshing && "animate-spin")}
          />
        </Button>
      </div>

      {!local ? (
        <p
          className="rounded-surface border border-border bg-surface-raised p-4 text-base text-ink shadow-raised"
          data-testid="no-route"
        >
          Connect once to load today’s route. It stays on this phone after that.
        </p>
      ) : local.route.day.kind === "SUNDAY" ? (
        <DayMessage>No collections on Sundays</DayMessage>
      ) : local.route.day.kind === "HOLIDAY" ? (
        <DayMessage>Today is a holiday: {local.route.day.name}</DayMessage>
      ) : customers.length === 0 ? (
        <DayMessage>No collections due today</DayMessage>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" data-numeric>
            <SummaryChip label="To visit" value={left} />
            <SummaryChip label="Done" value={customers.length - left} />
            {left === 0 ? (
              <p className="text-sm text-ink-muted">
                Everyone on the route is visited.
              </p>
            ) : null}
          </div>
          <ul className="flex flex-col gap-3" data-testid="route">
            {customers.map((customer) => (
              <li key={customer.customerId}>
                <CustomerRow customer={customer} local={local} />
              </li>
            ))}
          </ul>
          <Button
            tone="secondary"
            onClick={() => openView("#handover")}
            className="w-full"
          >
            <Money aria-hidden size={20} weight="regular" />
            Hand over today's cash
          </Button>
        </>
      )}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-control border border-border bg-surface-sunken px-3 text-sm text-ink-muted">
      {label}
      <span className="text-base font-semibold text-ink">{value}</span>
    </span>
  );
}

function DayMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-surface border border-border bg-surface-raised p-4 text-base font-medium text-ink shadow-raised"
      data-testid="empty-route"
    >
      {children}
    </p>
  );
}

/**
 * One tappable card per customer. A customer with several accounts is a group:
 * a header, then one row per account with its own expected amount — visibly
 * different from the single-account card, so a combined payment is not put
 * against the first account (BR-01a, S-01).
 */
function CustomerRow({
  customer,
  local,
}: {
  customer: Customer;
  local: LocalRoute;
}) {
  const grouped = customer.accounts.length > 1;
  const done = customer.accounts.every(
    (account) => local.rowState[account.accountLoanId] !== "PENDING",
  );

  return (
    <a
      href={`#collect/${customer.customerId}`}
      onClick={(event) => {
        event.preventDefault();
        openView(`#collect/${customer.customerId}`);
      }}
      className={cn(
        "flex flex-col overflow-hidden rounded-surface border text-left shadow-raised transition-colors active:translate-y-px",
        grouped ? "border-border-strong" : "border-border",
        done ? "bg-surface-sunken" : "bg-surface-raised",
      )}
      data-testid={`customer-${customer.customerCode}`}
    >
      {grouped ? (
        <>
          <span className="flex items-start justify-between gap-3 border-b border-border bg-surface-sunken px-4 py-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <CustomerName name={customer.name} done={done} />
              <span className="truncate text-sm text-ink-muted">
                {customer.address}
              </span>
            </span>
            <Badge tone="neutral" className="mt-0.5 shrink-0">
              {customer.accounts.length} accounts
            </Badge>
          </span>
          <span className="flex flex-col divide-y divide-border">
            {customer.accounts.map((account) => (
              <span
                key={account.accountLoanId}
                className="flex min-h-touch items-center gap-3 px-4 py-3"
                data-testid={`account-${account.accountCode}`}
                data-state={local.rowState[account.accountLoanId]}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-pill bg-accent"
                    />
                    <span
                      className="truncate font-mono text-sm font-medium text-ink"
                      data-numeric
                    >
                      {account.accountCode}
                    </span>
                  </span>
                  <Outstanding account={account} />
                  <RowStateMark
                    state={local.rowState[account.accountLoanId] ?? "PENDING"}
                  />
                </span>
                <Amount account={account} />
                <Chevron />
              </span>
            ))}
          </span>
        </>
      ) : (
        customer.accounts.map((account) => (
          <span
            key={account.accountLoanId}
            className="flex min-h-touch items-center gap-3 px-4 py-[var(--row-padding-y)]"
            data-testid={`account-${account.accountCode}`}
            data-state={local.rowState[account.accountLoanId]}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <CustomerName name={customer.name} done={done} />
              <span className="truncate text-sm text-ink-muted">
                {customer.address}
              </span>
              <Outstanding account={account} />
              <span className="mt-1.5 empty:hidden">
                <RowStateMark
                  state={local.rowState[account.accountLoanId] ?? "PENDING"}
                />
              </span>
            </span>
            <Amount account={account} />
            <Chevron />
          </span>
        ))
      )}
    </a>
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

function Outstanding({ account }: { account: Account }) {
  return (
    <span className="text-xs text-ink-muted" data-numeric>
      Outstanding{" "}
      <span data-testid="outstanding">
        {formatCurrency(account.outstandingAmount)}
      </span>
    </span>
  );
}

function Amount({ account }: { account: Account }) {
  return account.collectedToday ? (
    <span
      className="flex shrink-0 flex-col items-end text-ink-muted"
      data-testid="collected-today"
      data-numeric
    >
      <span className="text-xs">Collected</span>{" "}
      <span className="text-xl font-semibold text-ink-muted">
        {formatCurrency(account.collectedToday.amount)}
      </span>
    </span>
  ) : (
    <span
      className="shrink-0 text-xl font-semibold text-ink"
      data-testid="expected"
      data-numeric
    >
      {formatCurrency(account.expectedAmount)}
    </span>
  );
}

function Chevron() {
  return (
    <CaretRight
      aria-hidden
      size={20}
      weight="regular"
      className="shrink-0 text-ink-subtle"
    />
  );
}
