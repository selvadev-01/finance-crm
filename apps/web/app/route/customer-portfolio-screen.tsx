"use client";

import {
  CloudSlash,
  MapPin,
  Phone,
  Receipt,
} from "@phosphor-icons/react/dist/ssr";
import {
  type Account,
  accountContract,
  type CollectionListItem,
  collectionContract,
  type CustomerDetail,
  type CustomerOverview,
  customerContract,
  type ScheduleSlotView,
} from "@repo/contracts";
import {
  Badge,
  Button,
  cn,
  formatBusinessDate,
  formatCurrency,
  Meter,
  Skeleton,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { formatPerMille, perMille } from "../../lib/money";
import type { LocalRoute } from "../../lib/offline/outbox";
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";
import { openView } from "./hash-view";
import { ClassificationMark, formatClockTime } from "./sync-marks";

/** Days the payment strip shows, ending today. */
const STRIP = 14;
const RECENT = 5;

interface Portfolio {
  customer: CustomerDetail;
  overview: CustomerOverview;
  accounts: Array<{ account: Account; slots: ScheduleSlotView[] }>;
  recent: CollectionListItem[];
}

/**
 * J-10 · A customer's portfolio on the Junior's phone (2026-09-22): what they
 * owe across their accounts, how each account is going, the last two weeks
 * day by day, and the latest payments. **No invested amount or profit** — the
 * API sends them `null` to a Junior, and this screen never looks.
 *
 * Needs signal: the history is the office's, not the phone's. A customer due
 * today on the phone's route can still be recorded from here without it.
 */
export function CustomerPortfolioScreen({
  customerId,
  local,
  connected,
  businessDate,
}: {
  customerId: string;
  local: LocalRoute | null;
  connected: boolean;
  businessDate: string;
}) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onRoute = local?.route.customers.find(
    (candidate) => candidate.customerId === customerId,
  );
  const dueHere = onRoute?.accounts.some(
    (account) => local?.rowState[account.accountLoanId] === "PENDING",
  );

  const load = useCallback(async () => {
    try {
      const [customer, overview, accounts, recent] = await Promise.all([
        api(customerContract.getCustomer, { params: { customerId } }),
        api(customerContract.getCustomerOverview, { params: { customerId } }),
        api(accountContract.listAccounts, {
          query: { customerId, limit: 50 },
        }),
        api(collectionContract.listCustomerCollections, {
          params: { customerId },
          query: { limit: RECENT },
        }),
      ]);
      if (!customer.ok || !overview.ok || !accounts.ok || !recent.ok) {
        setProblem(
          customer.status === 404
            ? "This customer is not on your line."
            : "Could not load this customer. Try again.",
        );
        return;
      }
      const active = accounts.body.data.filter(
        (account) => account.status === "ACTIVE",
      );
      const schedules = await Promise.all(
        active.map((account) =>
          api(accountContract.getAccountSchedule, {
            params: { accountId: account.id },
          }),
        ),
      );
      setPortfolio({
        customer: customer.body,
        overview: overview.body,
        accounts: accounts.body.data.map((account) => {
          const index = active.indexOf(account);
          const schedule = index >= 0 ? schedules[index] : undefined;
          return {
            account,
            slots: schedule?.ok ? schedule.body.slots : [],
          };
        }),
        recent: recent.body.data,
      });
      setProblem(null);
    } catch {
      setProblem(null);
    }
  }, [customerId]);

  useEffect(() => {
    // Reading the portfolio is the external read this effect synchronises with.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  const name = portfolio?.customer.name ?? onRoute?.name ?? "Customer";
  const mobile = portfolio?.customer.mobile ?? onRoute?.mobile;

  return (
    <FieldPage
      back
      title={name}
      subtitle={
        portfolio || onRoute ? (
          <span className="font-mono text-xs" data-numeric>
            {portfolio?.customer.customerCode ?? onRoute?.customerCode}
          </span>
        ) : undefined
      }
      actions={
        mobile ? (
          <a
            href={`tel:${mobile}`}
            aria-label={`Call ${name}`}
            className="flex size-12 items-center justify-center rounded-pill bg-accent-subtle text-accent"
          >
            <Phone aria-hidden size={22} weight="regular" />
          </a>
        ) : null
      }
      footer={
        dueHere ? (
          <Button
            tone="primary"
            onClick={() => openView(`#collect/${customerId}`)}
            className="h-14 w-full rounded-pill text-lg font-semibold"
          >
            <Receipt aria-hidden size={22} weight="regular" />
            Record today’s collection
          </Button>
        ) : undefined
      }
      testId="customer-portfolio"
    >
      {!connected && !portfolio ? (
        <Banner tone="neutral" icon={<CloudSlash size={20} weight="regular" />}>
          Connect to see this customer’s accounts and payments.
          {dueHere ? " You can still record today’s collection." : ""}
        </Banner>
      ) : null}
      {problem ? (
        <Banner
          tone="critical"
          icon={<CloudSlash size={20} weight="regular" />}
        >
          {problem}
        </Banner>
      ) : null}

      {!portfolio && connected && !problem ? (
        <div
          role="status"
          aria-label="Loading this customer"
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-24 rounded-overlay" />
          <Skeleton className="h-36 rounded-overlay" />
          <Skeleton className="h-44 rounded-overlay" />
        </div>
      ) : null}

      {portfolio ? (
        <Loaded portfolio={portfolio} businessDate={businessDate} />
      ) : null}
    </FieldPage>
  );
}

function Loaded({
  portfolio,
  businessDate,
}: {
  portfolio: Portfolio;
  businessDate: string;
}) {
  const { customer, overview } = portfolio;
  const active = portfolio.accounts.filter(
    ({ account }) => account.status === "ACTIVE",
  );
  const others = portfolio.accounts.filter(
    ({ account }) => account.status !== "ACTIVE",
  );

  return (
    <>
      <div className={cn(cardClass, "flex flex-col divide-y divide-border")}>
        <p className="flex items-start gap-3 px-4 py-3 text-base text-ink">
          <MapPin
            aria-hidden
            size={20}
            weight="regular"
            className="mt-0.5 shrink-0 text-ink-muted"
          />
          {customer.address}
        </p>
        <a
          href={`tel:${customer.mobile}`}
          className="flex min-h-touch items-center gap-3 px-4 text-base font-medium text-accent"
          data-numeric
        >
          <Phone aria-hidden size={20} weight="regular" />
          {customer.mobile}
        </a>
      </div>

      <div
        className={cn(cardClass, "flex flex-col gap-3 p-4")}
        data-testid="portfolio-summary"
        data-numeric
      >
        <p className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">
          Total outstanding
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-ink">
            {formatCurrency(overview.outstandingTotal)}
          </span>
          <span className="text-sm text-ink-muted">
            {overview.accounts.active === 1
              ? "on 1 active account"
              : `across ${overview.accounts.active} active accounts`}
          </span>
        </p>
        <dl className="grid grid-cols-3 gap-2">
          <Figure
            label="Collected"
            value={formatCurrency(overview.collectedTotal)}
            hint="to date"
          />
          <Figure
            label="Missed"
            value={
              overview.missedDays === 1
                ? "1 day"
                : `${overview.missedDays} days`
            }
            tone={overview.missedDays > 0 ? "critical" : "plain"}
          />
          <Figure
            label="Last paid"
            value={
              overview.lastPaidOn
                ? formatBusinessDate(overview.lastPaidOn)
                : "Not yet"
            }
          />
        </dl>
      </div>

      <Section title={`Active accounts · ${active.length}`}>
        {active.length === 0 ? (
          <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
            No active account. Nothing is owed on this customer now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map(({ account, slots }) => (
              <li key={account.id}>
                <AccountCard
                  account={account}
                  slots={slots}
                  businessDate={businessDate}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {others.length > 0 ? (
        <Section title={`Closed and other · ${others.length}`}>
          <ul className={cn(cardClass, "flex flex-col divide-y divide-border")}>
            {others.map(({ account }) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="font-mono text-sm text-ink">
                  {account.accountCode}
                </span>
                <span className="text-sm text-ink-muted" data-numeric>
                  {formatCurrency(account.collectedAmount)} collected
                </span>
                <Badge tone="neutral" shape="pill">
                  {account.status === "COMPLETED"
                    ? "Completed"
                    : account.status === "WRITTEN_OFF"
                      ? "Written off"
                      : account.status === "DEFAULTED"
                        ? "Defaulted"
                        : "Pending"}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Recent payments">
        {portfolio.recent.length === 0 ? (
          <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
            No payments recorded yet.
          </p>
        ) : (
          <ul
            className={cn(cardClass, "flex flex-col divide-y divide-border")}
            data-testid="portfolio-payments"
          >
            {portfolio.recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm text-ink" data-numeric>
                    {formatBusinessDate(entry.businessDate)} ·{" "}
                    <span className="font-mono text-xs text-ink-muted">
                      {entry.accountCode}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted" data-numeric>
                    {formatClockTime(entry.capturedAt)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className="text-base font-semibold text-ink"
                    data-numeric
                  >
                    {entry.entryType === "ORIGINAL" &&
                    entry.classification === "NO_PAYMENT"
                      ? "No payment"
                      : formatCurrency(entry.amount)}
                  </span>
                  {entry.entryType === "ORIGINAL" ? (
                    <ClassificationMark classification={entry.classification} />
                  ) : (
                    <Badge tone="neutral" shape="pill">
                      Correction
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function AccountCard({
  account,
  slots,
  businessDate,
}: {
  account: Account;
  slots: ScheduleSlotView[];
  businessDate: string;
}) {
  const share = perMille(account.collectedAmount, account.accountAmount) ?? 0;
  const left = slots.filter((slot) => slot.status === "PENDING").length;
  const past = slots
    .filter(
      (slot) => slot.dueDate <= businessDate && slot.status !== "CANCELLED",
    )
    .slice(-STRIP);

  return (
    <div
      className={cn(
        cardClass,
        "flex flex-col gap-3 p-4",
        account.isOverdue && "border-critical-border",
      )}
      data-testid={`portfolio-account-${account.accountCode}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-base font-semibold text-ink">
            {account.accountCode}
          </span>
          <span className="text-xs text-ink-muted" data-numeric>
            Target finish {formatBusinessDate(account.targetCompletionDate)}
          </span>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="rounded-pill bg-accent-subtle px-2.5 py-0.5 text-sm font-semibold text-accent"
            data-numeric
          >
            {formatCurrency(account.dailyAmount)} / day
          </span>
          {account.isOverdue ? (
            <Badge tone="critical" shape="pill">
              Overdue
            </Badge>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-1.5" data-numeric>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-ink-muted">
            {formatCurrency(account.collectedAmount)} of{" "}
            {formatCurrency(account.accountAmount)} collected
          </span>
          <span className="font-semibold text-ink">
            {formatPerMille(share)}
          </span>
        </div>
        <Meter
          value={share}
          label={`Collected of ${account.accountCode}`}
          valueText={formatPerMille(share)}
          className="h-2.5"
        />
      </div>
      <dl
        className="grid grid-cols-2 divide-x divide-border rounded-surface bg-surface-sunken py-2.5"
        data-numeric
      >
        <div className="flex flex-col items-center gap-0.5 px-2 text-center">
          <dt className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Outstanding
          </dt>
          <dd className="text-base font-semibold text-ink">
            {formatCurrency(account.outstandingAmount)}
          </dd>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-2 text-center">
          <dt className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Days left
          </dt>
          <dd className="text-base font-semibold text-ink">{left}</dd>
        </div>
      </dl>
      {past.length > 0 ? <PaymentStrip slots={past} /> : null}
    </div>
  );
}

const SLOT = {
  COLLECTED: { label: "Paid", className: "bg-positive-bright" },
  PARTIAL: { label: "Part paid", className: "bg-warning-bright" },
  MISSED: { label: "Missed", className: "bg-critical-bright" },
  PENDING: {
    label: "Not yet",
    className: "border-2 border-border-strong bg-surface-raised",
  },
  CANCELLED: { label: "Cancelled", className: "bg-surface-sunken" },
} as const;

/**
 * The last fortnight, one mark a day: paid, part paid, missed or not yet. Each
 * mark says what it is to a screen reader, and the legend says it to everyone
 * — colour is never the only signal.
 */
function PaymentStrip({ slots }: { slots: ScheduleSlotView[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-ink-muted">
        Last {slots.length} days
      </p>
      <ol
        className="flex flex-wrap gap-1.5"
        aria-label="Last days, oldest first"
      >
        {slots.map((slot) => (
          <li
            key={slot.sequence}
            className={cn("size-4 rounded-pill", SLOT[slot.status].className)}
            title={`${formatBusinessDate(slot.dueDate)}: ${SLOT[slot.status].label}`}
          >
            <span className="sr-only">
              {formatBusinessDate(slot.dueDate)}: {SLOT[slot.status].label}
            </span>
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap gap-3 text-2xs text-ink-muted" aria-hidden>
        {(["COLLECTED", "PARTIAL", "MISSED", "PENDING"] as const).map((key) => (
          <span key={key} className="flex items-center gap-1">
            <span
              className={cn("size-2.5 rounded-pill", SLOT[key].className)}
            />
            {SLOT[key].label}
          </span>
        ))}
      </p>
    </div>
  );
}

function Figure({
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
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-surface px-3 py-2",
        tone === "critical" ? "bg-critical-subtle" : "bg-surface-sunken",
      )}
    >
      <dt
        className={cn(
          "text-xs",
          tone === "critical" ? "font-medium text-critical" : "text-ink-muted",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "truncate text-base font-semibold",
          tone === "critical" ? "text-critical" : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-2xs text-ink-muted">{hint}</dd> : null}
    </div>
  );
}
