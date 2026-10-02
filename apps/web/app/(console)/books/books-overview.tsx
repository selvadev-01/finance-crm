"use client";

import {
  ArrowRight,
  ArrowsLeftRight,
  Bank,
  CheckCircle,
  Coins,
  HandCoins,
  Receipt,
  UsersThree,
  Wallet,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  booksMoneyContract,
  ledgerContract,
  type LedgerTransactionView,
  statementsContract,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  arrowLinkClass,
  Badge,
  buttonClass,
  cn,
  EmptyFrame,
  formatBusinessDate,
  formatCurrency,
  ListSkeleton,
  NotPermitted,
  PageHeader,
  Section,
} from "@repo/ui";
import Link from "next/link";

import { LoadFailed } from "../../../components/query-state";
import {
  compareMoney,
  isNegativeMoney,
  perMille,
  sumMoney,
} from "../../../lib/money";
import { canManageOrganisation, seesSettings } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { bankLabel } from "./books-parts";
import { HoldingCard, IconMark, ShareBar, signedAmount } from "./visuals";

const TYPE_LABEL: Record<LedgerTransactionView["transactionType"], string> = {
  DISBURSEMENT: "Disbursement",
  COLLECTION: "Collection",
  HANDOVER: "Handover",
  ADJUSTMENT: "Correction",
  WRITE_OFF: "Write-off",
  CAPITAL: "Capital",
  EXPENSE: "Expense",
  BANK_TRANSFER: "Contra",
  DRAWINGS: "Drawings",
  OTHER_INCOME: "Other receipt",
  JOURNAL: "Journal voucher",
};

/**
 * Books overview (ADR-0018; Stitch B-01): where the business's money is now,
 * how the month is going, what needs the owner, and the latest movements —
 * read from the overview, this month's profit and loss, today's balance
 * sheet and the ledger, each on its own so one failing leaves the rest.
 */
export function BooksOverview() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = seesSettings(me.role);
  const today = toBusinessDate(new Date());
  const overview = useApiQuery(
    booksMoneyContract.getBooksOverview,
    allowed ? { query: { date: today } } : null,
  );
  const monthFrom =
    overview.status === "ready" ? overview.data.month.from : null;
  const pnl = useApiQuery(
    statementsContract.getProfitAndLoss,
    allowed && monthFrom ? { query: { from: monthFrom, to: today } } : null,
  );
  const sheet = useApiQuery(
    statementsContract.getBalanceSheet,
    allowed ? { query: { date: today } } : null,
  );
  const recent = useApiQuery(
    ledgerContract.listTransactions,
    allowed && monthFrom
      ? { query: { from: monthFrom, to: today, limit: 6 } }
      : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The books are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  return (
    <>
      <PageHeader
        title="Books"
        description={`Your business's own money, as of ${formatBusinessDate(today)}.`}
        actions={
          <Link href="/reports/trial-balance" className={arrowLinkClass}>
            Trial balance →
          </Link>
        }
      />

      {overview.status === "loading" ? (
        <ListSkeleton columns={4} rows={2} />
      ) : null}
      {overview.status === "error" ? (
        <LoadFailed message={overview.message} onRetry={overview.reload} />
      ) : null}

      {sheet.status === "ready" ? (
        <FundFlow
          capital={sheet.data.equity.capital}
          cashInHand={sheet.data.assets.officeCash}
          loans={sheet.data.assets.loansReceivable}
          withStaff={sumMoney(
            sheet.data.assets.cashWithStaff.map((person) => person.balance),
          )}
          profit={sheet.data.equity.retainedProfit}
        />
      ) : null}

      {overview.status === "ready" ? (
        <>
          <Section title="Cash & bank position">
            <ul
              aria-label="Cash & bank position"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
            >
              <HoldingCard
                icon={Wallet}
                label="Cash-in-hand"
                amount={overview.data.officeCash}
                caption={
                  isNegativeMoney(overview.data.officeCash)
                    ? "More has gone out than was put in"
                    : "In the office drawer"
                }
              />
              {overview.data.banks.map((bank) => (
                <HoldingCard
                  key={bank.bankAccountId}
                  icon={Bank}
                  label={bank.name}
                  amount={bank.balance}
                  caption={
                    bank.last4 ? `A/c no. ending ${bank.last4}` : "Bank account"
                  }
                />
              ))}
              {sheet.status === "ready" ? (
                <>
                  <HoldingCard
                    icon={UsersThree}
                    label="Cash with collection staff"
                    amount={sumMoney(
                      sheet.data.assets.cashWithStaff.map((p) => p.balance),
                    )}
                    caption={`Collected, not yet handed over · ${sheet.data.assets.cashWithStaff.length} ${sheet.data.assets.cashWithStaff.length === 1 ? "person" : "people"}`}
                  />
                  <HoldingCard
                    icon={HandCoins}
                    label="Loans & advances"
                    amount={sheet.data.assets.loansReceivable}
                    caption="Outstanding on loan accounts"
                  />
                </>
              ) : null}
            </ul>
            {overview.data.banks.length === 0 ? (
              <p className="text-caption text-ink-muted">
                No bank accounts yet.{" "}
                <Link href="/settings/bank-accounts" className="underline">
                  Add one in Settings
                </Link>
                .
              </p>
            ) : null}
            {sheet.status === "ready" ? (
              <ShareBar
                label="Balance share"
                parts={[
                  {
                    key: "loans",
                    label: "Lent to customers",
                    amount: sheet.data.assets.loansReceivable,
                  },
                  ...overview.data.banks.map((bank) => ({
                    key: bank.bankAccountId,
                    label: bankLabel(bank),
                    amount: bank.balance,
                  })),
                  {
                    key: "office",
                    label: "Office cash",
                    amount: overview.data.officeCash,
                  },
                  {
                    key: "staff",
                    label: "With staff",
                    amount: sumMoney(
                      sheet.data.assets.cashWithStaff.map((p) => p.balance),
                    ),
                  },
                ]}
              />
            ) : null}
          </Section>

          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <MonthCard
              from={overview.data.month.from}
              to={overview.data.asOf}
              pnl={pnl}
              drawings={overview.data.month.drawings}
              capital={overview.data.month.capital}
            />
            <AttentionCard
              pending={overview.data.month.pendingFieldExpenses}
              officeCash={overview.data.officeCash}
            />
          </div>

          <Section title="Quick actions">
            <ul
              aria-label="Quick actions"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <QuickAction
                href="/books/expenses?action=record"
                icon={Receipt}
                title="Record expense"
                caption="Rent, salary, bills"
              />
              <QuickAction
                href="/books/money?action=transfer"
                icon={ArrowsLeftRight}
                title="Contra entry"
                caption="Cash ↔ bank"
              />
              <QuickAction
                href="/books/money?action=income"
                icon={Coins}
                title="Record receipt"
                caption="Fees, bank interest (other receipts)"
              />
              {owner ? (
                <QuickAction
                  href="/books/money?action=drawing"
                  icon={HandCoins}
                  title="Record drawing"
                  caption="Owner only"
                />
              ) : null}
            </ul>
          </Section>

          <Section
            title="Day book"
            actions={
              <Link href="/books/cash-book" className={arrowLinkClass}>
                Open cash book →
              </Link>
            }
          >
            {recent.status === "loading" ? (
              <ListSkeleton columns={3} rows={3} />
            ) : null}
            {recent.status === "error" ? (
              <LoadFailed message={recent.message} onRetry={recent.reload} />
            ) : null}
            {recent.status === "ready" ? (
              recent.data.data.length === 0 ? (
                <p className="text-body text-ink-muted">
                  No money has moved this month yet.
                </p>
              ) : (
                <ul
                  aria-label="Day book"
                  className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-surface-raised"
                >
                  {recent.data.data.map((posting) => (
                    <li
                      key={posting.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body text-ink">
                          {posting.description}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {TYPE_LABEL[posting.transactionType]} ·{" "}
                          {formatBusinessDate(posting.businessDate)}
                          {posting.createdByName
                            ? ` · ${posting.createdByName}`
                            : ""}
                        </span>
                      </span>
                      <span className="text-body text-ink" data-numeric>
                        {formatCurrency(posting.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Section>
        </>
      ) : null}
    </>
  );
}

/**
 * How the money goes round (decided 2026-10-02): the owner puts capital in,
 * a loan is paid out of cash-in-hand, customers repay to the collection staff,
 * and a handover brings it back to cash-in-hand — with the profit kept. Every
 * figure is today's, from the balance sheet.
 */
function FundFlow({
  capital,
  cashInHand,
  loans,
  withStaff,
  profit,
}: {
  capital: string;
  cashInHand: string;
  loans: string;
  withStaff: string;
  profit: string;
}) {
  const steps = [
    {
      icon: Coins,
      label: "Capital A/c",
      amount: capital,
      caption: "Put in by the owner",
    },
    {
      icon: Wallet,
      label: "Cash-in-hand",
      amount: cashInHand,
      caption: "Ready to lend",
    },
    {
      icon: HandCoins,
      label: "Loans & advances",
      amount: loans,
      caption: "Outstanding with customers",
    },
    {
      icon: UsersThree,
      label: "Cash with collection staff",
      amount: withStaff,
      caption: "Collected, back to cash-in-hand at handover",
    },
    {
      icon: Receipt,
      label: "Reserves & surplus",
      amount: profit,
      caption: "Profit kept in the business",
    },
  ] as const;
  return (
    <section
      aria-label="Fund flow"
      className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading text-ink">Fund flow</h2>
        <Link href="/books/money" className={arrowLinkClass}>
          Capital A/c →
        </Link>
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="relative flex items-center gap-3 rounded-control bg-surface-sunken px-3 py-3 md:flex-col md:items-start md:gap-2"
          >
            <IconMark icon={step.icon} />
            <span className="flex min-w-0 flex-col">
              <span className="text-caption text-ink-muted">{step.label}</span>
              <span
                className={cn(
                  "text-heading",
                  isNegativeMoney(step.amount) ? "text-critical" : "text-ink",
                )}
                data-numeric
              >
                {signedAmount(step.amount)}
              </span>
              <span className="text-caption text-ink-muted">
                {step.caption}
              </span>
            </span>
            {index < steps.length - 1 ? (
              <ArrowRight
                aria-hidden
                size={16}
                className="absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 rounded-pill bg-surface-raised text-ink-subtle md:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

type PnlQuery = ReturnType<
  typeof useApiQuery<typeof statementsContract.getProfitAndLoss>
>;

/** The month so far: income against expenses, and what is left. */
function MonthCard({
  from,
  to,
  pnl,
  drawings,
  capital,
}: {
  from: string;
  to: string;
  pnl: PnlQuery;
  drawings: string;
  capital: string;
}) {
  return (
    <section
      aria-label="This month"
      className="flex flex-col gap-4 rounded-surface border border-border bg-surface-raised p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-heading text-ink">This month</h2>
        <span className="text-caption text-ink-muted">
          {formatBusinessDate(from)} – {formatBusinessDate(to)}
        </span>
      </div>
      {pnl.status === "loading" ? <ListSkeleton columns={2} rows={2} /> : null}
      {pnl.status === "error" ? (
        <LoadFailed message={pnl.message} onRetry={pnl.reload} />
      ) : null}
      {pnl.status === "ready" ? (
        <>
          {(
            [
              ["Income", pnl.data.income.total, "bg-accent"],
              ["Expenses", pnl.data.expenses.total, "bg-ink-subtle"],
            ] as const
          ).map(([label, amount, fill]) => {
            const larger =
              compareMoney(pnl.data.income.total, pnl.data.expenses.total) > 0
                ? pnl.data.income.total
                : pnl.data.expenses.total;
            return (
              <div key={label} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-body">
                  <span className="text-ink-muted">{label}</span>
                  <span className="text-ink" data-numeric>
                    {signedAmount(amount)}
                  </span>
                </div>
                <span className="block h-2 overflow-hidden rounded-pill bg-surface-sunken">
                  <span
                    className={cn("block h-full rounded-pill", fill)}
                    style={{
                      width: `${Math.min(perMille(amount, larger) ?? 0, 1000) / 10}%`,
                    }}
                  />
                </span>
              </div>
            );
          })}
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-control border px-4 py-3",
              isNegativeMoney(pnl.data.netProfit)
                ? "border-critical-border bg-critical-subtle"
                : "border-positive-border bg-positive-subtle",
            )}
          >
            <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
              {isNegativeMoney(pnl.data.netProfit) ? "Net loss" : "Net profit"}
            </span>
            <span
              className={cn(
                "text-title",
                isNegativeMoney(pnl.data.netProfit)
                  ? "text-critical"
                  : "text-positive",
              )}
              data-numeric
            >
              {signedAmount(pnl.data.netProfit)}
            </span>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-border border-t border-border pt-3 text-caption">
            {(
              [
                ["Other receipts", pnl.data.income.otherIncome],
                ["Drawings", drawings],
                ["Capital A/c", capital],
              ] as const
            ).map(([label, amount]) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 px-3 first:pl-0"
              >
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-body text-ink" data-numeric>
                  {formatCurrency(amount)}
                </dd>
              </div>
            ))}
          </dl>
          <Link href="/books/profit-and-loss" className={arrowLinkClass}>
            See profit & loss →
          </Link>
        </>
      ) : null}
    </section>
  );
}

/** What waits on the owner — only things the books actually know. */
function AttentionCard({
  pending,
  officeCash,
}: {
  pending: number;
  officeCash: string;
}) {
  const short = isNegativeMoney(officeCash);
  return (
    <section
      aria-label="Pending actions"
      className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5"
    >
      <h2 className="text-heading text-ink">Pending actions</h2>
      {pending > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning-border bg-warning-subtle px-4 py-3">
          <span className="flex items-center gap-3">
            <IconMark icon={Receipt} tone="warning" />
            <span className="text-body text-ink">
              {pending} field {pending === 1 ? "expense is" : "expenses are"}{" "}
              pending approval
            </span>
          </span>
          <Link
            href="/books/expenses?status=PENDING"
            className={buttonClass("primary", undefined, "sm")}
          >
            Review
          </Link>
        </div>
      ) : null}
      {short ? (
        <div className="flex items-start gap-3 rounded-control border border-critical-border bg-critical-subtle px-4 py-3 text-body text-ink">
          <Warning
            aria-hidden
            size={20}
            weight="regular"
            className="mt-0.5 shrink-0 text-critical"
          />
          Cash-in-hand is negative. Record the capital that funded the loans and
          expenses.
        </div>
      ) : null}
      {pending === 0 && !short ? (
        <p className="flex items-center gap-2 text-body text-ink-muted">
          <CheckCircle
            aria-hidden
            size={20}
            weight="regular"
            className="text-positive"
          />
          No pending actions.
        </p>
      ) : null}
    </section>
  );
}

function QuickAction({
  href,
  icon,
  title,
  caption,
}: {
  href: string;
  icon: typeof Receipt;
  title: string;
  caption: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-surface border border-border bg-surface-raised p-4 transition-colors hover:border-accent hover:bg-accent-subtle"
      >
        <IconMark icon={icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-medium text-ink">{title}</span>
          <span className="text-caption text-ink-muted">{caption}</span>
        </span>
        <ArrowRight aria-hidden size={16} className="text-ink-subtle" />
      </Link>
    </li>
  );
}
