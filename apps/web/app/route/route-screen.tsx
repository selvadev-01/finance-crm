"use client";

import {
  ArrowClockwise,
  ArrowRight,
  ArrowsClockwise,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  CloudArrowDown,
  CloudSlash,
  ListChecks,
  MagnifyingGlass,
  Path,
  Play,
  PlusCircle,
  Receipt,
  Sun,
  User,
  UsersThree,
  Wallet,
  X,
} from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import { dayOfWeek, parseCalendarDate } from "@repo/domain";
import { Button, cn, formatBusinessDate, formatCurrency } from "@repo/ui";
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
  name,
  local,
  businessDate,
  connected,
  unsynced,
  refreshing,
  onRefresh,
}: {
  /** The Junior, for the greeting (Stitch J-01). */
  name: string;
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
      title="Collection route"
      subtitle={
        local?.route.line ? (
          <span className="font-mono">
            {local.route.line.code} · {local.route.line.name}
          </span>
        ) : (
          formatBusinessDate(businessDate)
        )
      }
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
        <WorkingDay
          name={name}
          businessDate={businessDate}
          local={local}
          unsynced={unsynced}
        />
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
  name,
  businessDate,
  local,
  unsynced,
}: {
  name: string;
  businessDate: string;
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
  // What today's route asks for, every account due: the "of ₹… due" line.
  const due = sumMoney(
    customers.flatMap((customer) =>
      customer.accounts.map((account) => account.expectedAmount),
    ),
  );
  // The next door: the first customer still to visit, in the Senior's order.
  const next = left[0] ?? null;

  return (
    <div className="flex flex-col gap-3.5" data-testid="route">
      <section className="flex flex-col">
        <span className="text-xs font-medium tracking-wide text-ink-muted">
          {WEEKDAY[dayOfWeek(parseCalendarDate(businessDate))]},{" "}
          {formatBusinessDate(businessDate, "day-month")}
        </span>
        <h2 className="text-2xl leading-snug font-semibold tracking-tight text-ink">
          {greeting(new Date())}, {name.split(" ")[0]}
        </h2>
      </section>

      <section
        aria-label="Today’s progress"
        className="relative flex flex-col gap-4 overflow-hidden rounded-overlay bg-accent-hover p-4 text-accent-ink shadow-raised"
        data-numeric
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-pill bg-accent-ink/5"
        />
        <div className="relative flex items-center justify-between gap-3">
          <VisitRing done={done.length} total={customers.length} />
          <div className="flex min-w-0 flex-col items-end text-right">
            <span className="text-3xl leading-none font-bold tracking-tight">
              {rupees(collected)}
            </span>
            <span className="mt-1 text-xs font-medium opacity-90">
              collected today
            </span>
            <span className="text-xs font-medium opacity-80">
              of {rupees(due)} due
            </span>
          </div>
        </div>
        <p className="sr-only">
          {done.length} of {customers.length} visited
        </p>
        <dl className="relative grid grid-cols-2 divide-x divide-accent-ink/20 border-t border-accent-ink/20 pt-3 text-center">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs opacity-80">Left to visit</dt>
            <dd className="text-lg font-bold">
              {left.length} {left.length === 1 ? "stop" : "stops"}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs opacity-80">Not sent</dt>
            <dd className="text-lg font-bold">{unsynced}</dd>
          </div>
        </dl>
      </section>

      {next ? (
        <a
          href={`#collect/${next.customerId}`}
          onClick={(event) => {
            event.preventDefault();
            openView(`#collect/${next.customerId}`);
          }}
          className="flex h-14 items-center justify-between gap-3 rounded-pill bg-accent px-5 text-base font-semibold text-accent-ink shadow-raised transition-transform active:scale-[0.98] active:bg-accent-hover"
          data-numeric
        >
          <span className="flex min-w-0 items-center gap-2">
            <Play aria-hidden size={18} weight="fill" className="shrink-0" />
            <span className="truncate">
              Next: <strong className="font-bold">{next.name}</strong> ·{" "}
              {rupees(
                sumMoney(
                  next.accounts.map((account) => account.expectedAmount),
                ),
              )}
            </span>
          </span>
          <ArrowRight aria-hidden size={22} weight="regular" />
        </a>
      ) : null}

      <FieldMenu
        unsynced={unsynced}
        nextCustomerId={next?.customerId ?? null}
      />

      {unsynced > 0 ? (
        <a
          href="#sync"
          onClick={(event) => {
            event.preventDefault();
            openView("#sync");
          }}
          className={cn(
            cardClass,
            "flex items-start gap-3 border-warning-border bg-warning-subtle p-4 text-base text-ink",
          )}
        >
          <CloudSlash
            aria-hidden
            size={22}
            weight="regular"
            className="mt-0.5 shrink-0 text-warning"
          />
          <span>
            {unsynced} {unsynced === 1 ? "collection is" : "collections are"}{" "}
            safe on this phone. They send by themselves when you are online.
          </span>
        </a>
      ) : null}

      <div
        id="todays-route"
        className="flex scroll-mt-20 items-center justify-between px-1 pt-1"
      >
        <h2 className="text-lg font-semibold text-ink">Today’s route</h2>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className="text-sm font-semibold text-accent"
        >
          See all ({customers.length})
        </button>
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

/**
 * Customers visited as a ring on the teal card (Stitch J-01). The circle's
 * `pathLength` is 1000, so the share is the stroke's length as it stands.
 */
function VisitRing({ done, total }: { done: number; total: number }) {
  const share = total === 0 ? 0 : Math.floor((done * 1000) / total);
  return (
    <span
      role="meter"
      aria-label="Customers visited"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
      className="relative grid size-24 shrink-0 place-items-center"
    >
      <svg
        aria-hidden
        viewBox="0 0 44 44"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="4"
          className="stroke-accent-ink/20"
        />
        <circle
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="4"
          strokeLinecap={share === 0 ? "butt" : "round"}
          pathLength={1000}
          strokeDasharray={`${share} 1000`}
          className="stroke-accent-ink"
        />
      </svg>
      <span className="flex flex-col items-center leading-tight">
        <span className="text-xl font-semibold">
          {done}/{total}
        </span>
        <span className="text-2xs font-medium tracking-wide uppercase opacity-80">
          visited
        </span>
      </span>
    </span>
  );
}

type FieldTile = {
  key: string;
  label: string;
  icon: typeof Wallet;
  hash: string;
  open: () => void;
};

const scrollToRoute = () =>
  document
    .getElementById("todays-route")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * The Junior's menu (Stitch J-01): eight large tiles, four to a row, for the
 * places a day takes them. Each is a view of this one page, so every tile
 * opens offline as the route does; handing over and expenses still need
 * signal, and say so on their own screens. "Collect" opens the next
 * customer, and "Route" brings today's list into view.
 *
 * The design's "My cash" tile is "Collections" here: the Cash screen is
 * already "Hand over", and two tiles to one screen would be a dead end.
 */
function FieldMenu({
  unsynced,
  nextCustomerId,
}: {
  unsynced: number;
  nextCustomerId: string | null;
}) {
  const nextHash = nextCustomerId
    ? (`#collect/${nextCustomerId}` as const)
    : null;
  const tiles: FieldTile[] = [
    {
      key: "route",
      label: "Route",
      icon: Path,
      hash: "#todays-route",
      open: scrollToRoute,
    },
    {
      key: "collect",
      label: "Collect",
      icon: PlusCircle,
      hash: nextHash ?? "#todays-route",
      open: () => (nextHash ? openView(nextHash) : scrollToRoute()),
    },
    {
      key: "handover",
      label: "Hand over",
      icon: Wallet,
      hash: "#handover",
      open: () => switchTab("handover"),
    },
    {
      key: "expense",
      label: "Expense",
      icon: Receipt,
      hash: "#expense",
      open: () => openView("#expense"),
    },
    {
      key: "sync",
      label: "Sync",
      icon: ArrowsClockwise,
      hash: "#sync",
      open: () => openView("#sync"),
    },
    {
      key: "collections",
      label: "Collections",
      icon: ListChecks,
      hash: "#collections",
      open: () => switchTab("collections"),
    },
    {
      key: "customers",
      label: "Customers",
      icon: UsersThree,
      hash: "#customers",
      open: () => switchTab("customers"),
    },
    {
      key: "profile",
      label: "Profile",
      icon: User,
      hash: "#profile",
      open: () => switchTab("profile"),
    },
  ];
  return (
    <nav aria-labelledby="field-menu" className="flex flex-col gap-2">
      <span
        id="field-menu"
        className="px-1 text-xs font-bold tracking-wider text-ink-muted uppercase"
      >
        Menu
      </span>
      <ul className="grid grid-cols-4 gap-x-2.5 gap-y-3">
        {tiles.map((tile) => {
          const count = tile.key === "sync" && unsynced > 0 ? unsynced : null;
          return (
            <li key={tile.key}>
              <a
                href={tile.hash}
                onClick={(event) => {
                  event.preventDefault();
                  tile.open();
                }}
                aria-label={
                  count ? `${tile.label}, ${count} not sent` : tile.label
                }
                className="group flex flex-col items-center text-center transition-transform active:scale-95"
              >
                <span className="relative grid size-14 place-items-center rounded-overlay bg-accent-subtle text-accent shadow-raised">
                  <tile.icon aria-hidden size={26} weight="regular" />
                  {count ? (
                    <span
                      aria-hidden
                      className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-pill border-2 border-surface-raised bg-warning text-2xs font-bold text-surface-raised"
                      data-numeric
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1.5 text-xs leading-tight font-medium text-ink">
                  {tile.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Good morning", by the phone's own clock. */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "₹5,220": `formatCurrency`'s own string, ".00" dropped only when there are no paise. */
function rupees(amount: string): string {
  return formatCurrency(amount).replace(/\.00$/, "");
}

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

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
