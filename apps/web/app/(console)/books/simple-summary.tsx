"use client";

import {
  ArrowDownLeft,
  HandCoins,
  PlusCircle,
  Receipt,
} from "@phosphor-icons/react/dist/ssr";
import {
  booksMoneyContract,
  ledgerContract,
  type LedgerTransactionView,
  statementsContract,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  buttonClass,
  EmptyFrame,
  formatBusinessDate,
  FormMessage,
  ListSkeleton,
  NotPermitted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";

import { LoadFailed } from "../../../components/query-state";
import { isNegativeMoney, sumMoney } from "../../../lib/money";
import { canAddCapital, canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { signedAmount } from "./visuals";

/** Every entry in everyday words (simple Books, lib/books-mode.ts). */
const KIND: Record<LedgerTransactionView["transactionType"], string> = {
  DISBURSEMENT: "Loan given",
  COLLECTION: "Collection",
  HANDOVER: "Cash handed over",
  ADJUSTMENT: "Correction",
  WRITE_OFF: "Loan written off",
  CAPITAL: "Money added",
  EXPENSE: "Expense",
  BANK_TRANSFER: "Bank",
  DRAWINGS: "Owner took out",
  OTHER_INCOME: "Other income",
  JOURNAL: "Adjustment",
};

/**
 * Simple Books (decided with the owner 2026-10-02): four numbers, four
 * buttons, what is waiting, and the latest entries — nothing else. The full
 * overview (`books-overview.tsx`) is kept for when `BOOKS_SIMPLE` is off.
 */
export function SimpleSummary() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = canAddCapital(me.role);
  const today = toBusinessDate(new Date());
  const overview = useApiQuery(
    booksMoneyContract.getBooksOverview,
    allowed ? { query: { date: today } } : null,
  );
  const monthFrom =
    overview.status === "ready" ? overview.data.month.from : null;
  const profit = useApiQuery(
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
      ? { query: { from: monthFrom, to: today, limit: 8 } }
      : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The books are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  const withStaff =
    sheet.status === "ready"
      ? sumMoney(
          sheet.data.assets.cashWithStaff.map((person) => person.balance),
        )
      : null;

  return (
    <>
      <PageHeader
        title="Money"
        description={`Your business money today, ${formatBusinessDate(today)}.`}
      />

      {overview.status === "loading" ? (
        <ListSkeleton columns={4} rows={1} />
      ) : null}
      {overview.status === "error" ? (
        <LoadFailed message={overview.message} onRetry={overview.reload} />
      ) : null}

      {overview.status === "ready" ? (
        <>
          <StatGrid columns={4} aria-label="Money today">
            <Stat
              label="Cash in hand"
              hint="At the office, ready to lend"
              tone={
                isNegativeMoney(overview.data.officeCash)
                  ? "critical"
                  : "neutral"
              }
            >
              {signedAmount(overview.data.officeCash)}
            </Stat>
            <Stat label="With collection staff" hint="Not handed over yet">
              {withStaff !== null ? signedAmount(withStaff) : "—"}
            </Stat>
            <Stat label="To collect from customers" hint="Still owed on loans">
              {sheet.status === "ready"
                ? signedAmount(sheet.data.assets.loansReceivable)
                : "—"}
            </Stat>
            <Stat
              label="Profit this month"
              hint="Income less expenses"
              tone={
                profit.status === "ready" &&
                isNegativeMoney(profit.data.netProfit)
                  ? "critical"
                  : "neutral"
              }
            >
              {profit.status === "ready"
                ? signedAmount(profit.data.netProfit)
                : "—"}
            </Stat>
          </StatGrid>

          {overview.data.month.pendingFieldExpenses > 0 ? (
            <FormMessage
              tone="warning"
              action={
                <Link
                  href="/books/expenses?status=PENDING"
                  className={buttonClass("primary", undefined, "sm")}
                >
                  Review
                </Link>
              }
            >
              {overview.data.month.pendingFieldExpenses} staff{" "}
              {overview.data.month.pendingFieldExpenses === 1
                ? "expense is"
                : "expenses are"}{" "}
              waiting for approval.
            </FormMessage>
          ) : null}
          {isNegativeMoney(overview.data.officeCash) ? (
            <FormMessage tone="critical">
              Cash in hand is below zero. Add money before giving more loans.
            </FormMessage>
          ) : null}

          <ul
            aria-label="Actions"
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {owner ? (
              <ActionLink
                href="/books/money?action=capital"
                icon={PlusCircle}
                label="Add money"
              />
            ) : null}
            <ActionLink
              href="/books/expenses?action=record"
              icon={Receipt}
              label="Add expense"
            />
            <ActionLink
              href="/books/money?action=income"
              icon={ArrowDownLeft}
              label="Other income"
            />
            {owner ? (
              <ActionLink
                href="/books/money?action=drawing"
                icon={HandCoins}
                label="Owner took money"
              />
            ) : null}
          </ul>
        </>
      ) : null}

      <Section title="Latest entries">
        {recent.status === "loading" ? (
          <ListSkeleton columns={3} rows={4} />
        ) : null}
        {recent.status === "error" ? (
          <LoadFailed message={recent.message} onRetry={recent.reload} />
        ) : null}
        {recent.status === "ready" ? (
          recent.data.data.length === 0 ? (
            <p className="text-body text-ink-muted">Nothing yet this month.</p>
          ) : (
            <ul
              aria-label="Latest entries"
              className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised"
            >
              {recent.data.data.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-ink">
                      {KIND[entry.transactionType]}
                    </span>
                    <span className="truncate text-caption text-ink-muted">
                      {formatBusinessDate(entry.businessDate)} ·{" "}
                      {entry.description}
                    </span>
                  </span>
                  <span className="text-ink" data-numeric>
                    {signedAmount(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Section>
    </>
  );
}

function ActionLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Receipt;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex h-full min-h-20 flex-col items-start justify-center gap-2 rounded-surface border border-border bg-surface-raised p-4 text-ink transition-colors hover:border-accent hover:bg-accent-subtle"
      >
        <Icon aria-hidden size={24} weight="regular" className="text-accent" />
        <span className="font-medium">{label}</span>
      </Link>
    </li>
  );
}
