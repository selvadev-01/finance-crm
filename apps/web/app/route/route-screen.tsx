import { ArrowClockwise, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import { Badge, Button, cn, formatBusinessDate, formatCurrency } from "@repo/ui";

import type { LocalRoute } from "../../lib/offline/outbox";
import { openView } from "./hash-view";
import { formatClockTime, RowStateMark } from "./sync-marks";

type Customer = RouteView["customers"][number];

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
    customer.accounts.some((account) => local?.rowState[account.accountLoanId] === "PENDING"),
  ).length;

  return (
    <div className="flex flex-col gap-[var(--stack-gap)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-ink">Today’s route</h1>
          <p className="text-sm text-ink-muted">
            {formatBusinessDate(businessDate)} · {name}
          </p>
          {local ? (
            <p className="text-xs text-ink-muted" data-testid="route-fetched">
              {connected ? "Updated" : "Phone copy from"} {formatClockTime(local.fetchedAt)}
              {local.optimistic ? " · includes collections not yet sent" : ""}
            </p>
          ) : null}
        </div>
        <Button tone="secondary" onClick={onRefresh} disabled={refreshing} aria-label="Refresh route">
          <ArrowClockwise aria-hidden size={20} weight="regular" className={cn(refreshing && "animate-spin")} />
        </Button>
      </div>

      {!local ? (
        <p className="rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4 text-ink" data-testid="no-route">
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
          <p className="text-sm text-ink-muted" data-numeric>
            {left === 0 ? "Everyone on the route is visited." : `${left} of ${customers.length} customers left to visit`}
          </p>
          <ul className="flex flex-col gap-2" data-testid="route">
            {customers.map((customer) => (
              <li key={customer.customerId}>
                <CustomerRow customer={customer} local={local} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DayMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4 text-base font-medium text-ink"
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
function CustomerRow({ customer, local }: { customer: Customer; local: LocalRoute }) {
  const grouped = customer.accounts.length > 1;
  const done = customer.accounts.every((account) => local.rowState[account.accountLoanId] !== "PENDING");

  return (
    <a
      href={`#collect/${customer.customerId}`}
      onClick={(event) => {
        event.preventDefault();
        openView(`#collect/${customer.customerId}`);
      }}
      className={cn(
        "flex flex-col rounded-[var(--radius-surface)] border bg-surface-raised text-left transition-colors active:translate-y-px",
        grouped ? "border-border-strong" : "border-border",
        done && "bg-surface-sunken",
      )}
      data-testid={`customer-${customer.customerCode}`}
    >
      <span className="flex items-center justify-between gap-3 px-4 py-[var(--row-padding-y)]">
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate text-base font-semibold", done ? "text-ink-muted" : "text-ink")}>{customer.name}</span>
          <span className="truncate text-sm text-ink-muted">{customer.address}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {grouped ? <Badge tone="neutral">{customer.accounts.length} accounts</Badge> : null}
          <CaretRight aria-hidden size={20} weight="regular" className="text-ink-subtle" />
        </span>
      </span>
      {customer.accounts.map((account) => (
        <span
          key={account.accountLoanId}
          className={cn(
            "flex items-center justify-between gap-3 px-4",
            grouped ? "border-t border-border py-2" : "pb-[var(--row-padding-y)]",
          )}
          data-testid={`account-${account.accountCode}`}
          data-state={local.rowState[account.accountLoanId]}
        >
          <span className="flex min-w-0 flex-col" data-numeric>
            {grouped ? <span className="text-xs text-ink-muted">{account.accountCode}</span> : null}
            <span className="text-sm text-ink-muted">
              Outstanding <span data-testid="outstanding">{formatCurrency(account.outstandingAmount)}</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1" data-numeric>
            {account.collectedToday ? (
              <span className="text-base text-ink-muted" data-testid="collected-today">
                Collected <span className="font-semibold">{formatCurrency(account.collectedToday.amount)}</span>
              </span>
            ) : (
              <span className="text-lg font-semibold text-ink" data-testid="expected">
                {formatCurrency(account.expectedAmount)}
              </span>
            )}
            <RowStateMark state={local.rowState[account.accountLoanId] ?? "PENDING"} />
          </span>
        </span>
      ))}
    </a>
  );
}
