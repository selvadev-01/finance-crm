"use client";

import { Warning } from "@phosphor-icons/react/dist/ssr";
import {
  accountContract,
  collectionContract,
  type CustomerOverview,
} from "@repo/contracts";
import {
  Card,
  formatBusinessDate,
  formatCurrency,
  Meter,
  NothingYet,
  Section,
  Skeleton,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";

import { LoadFailed } from "../../../../components/query-state";
import {
  AccountStatusBadge,
  CollectionEntryBadge,
} from "../../../../components/status-badge";
import { formatPerMille, perMille } from "../../../../lib/money";
import { useApiQuery } from "../../../../lib/use-api-query";

/** How many recent payments the portfolio shows; the Collections tab has all. */
const RECENT = 6;

/**
 * The portfolio figures at the top of Customer 360 (S-09p, 2026-09-22), for
 * every console role. Summed server-side across accounts (US-022); invested
 * and profit arrive `null` for a role that may not see them, and the tiles go
 * with them rather than showing a dash.
 */
export function PortfolioFigures({ overview }: { overview: CustomerOverview }) {
  const { accounts } = overview;
  return (
    <div className="flex flex-col gap-3">
      <StatGrid columns={3}>
        <Stat
          label={
            accounts.active === 1
              ? "Outstanding on 1 active account"
              : `Outstanding across ${accounts.active} active accounts`
          }
        >
          {formatCurrency(overview.outstandingTotal)}
        </Stat>
        <Stat label="Collected, all accounts">
          {formatCurrency(overview.collectedTotal)}
        </Stat>
        <Stat label="Accounts">
          {accounts.active} active · {accounts.completed} completed
          {accounts.other > 0 ? ` · ${accounts.other} other` : ""}
        </Stat>
        {overview.investedTotal !== null ? (
          <Stat label="Invested, all accounts">
            {formatCurrency(overview.investedTotal)}
          </Stat>
        ) : null}
        {overview.profitTotal !== null ? (
          <Stat label="Profit on these accounts">
            {formatCurrency(overview.profitTotal)}
          </Stat>
        ) : null}
        <Stat label="Missed days, active accounts">{overview.missedDays}</Stat>
        <Stat label="Last paid">
          {overview.lastPaidOn
            ? formatBusinessDate(overview.lastPaidOn)
            : "Not yet"}
        </Stat>
      </StatGrid>
      {overview.overdueAccounts > 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-surface border border-critical-border bg-critical-subtle px-4 py-3 text-body font-medium text-critical"
        >
          <Warning aria-hidden size={18} weight="regular" />
          {overview.overdueAccounts === 1
            ? "1 account is past its target date with money still owed."
            : `${overview.overdueAccounts} accounts are past their target date with money still owed.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Portfolio tab: each account's progress towards its amount, and the
 * latest payments across them. The full lists are the Accounts and
 * Collections tabs; this is the one screen that answers "how is this
 * customer doing".
 */
export function PortfolioTab({ customerId }: { customerId: string }) {
  const accounts = useApiQuery(accountContract.listAccounts, {
    query: { customerId, limit: 50 },
  });
  const recent = useApiQuery(collectionContract.listCustomerCollections, {
    params: { customerId },
    query: { limit: RECENT },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Section title="Accounts in portfolio" as="h3">
        {accounts.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : accounts.status !== "ready" ? (
          <LoadFailed
            message={
              accounts.status === "error"
                ? accounts.message
                : "These accounts could not be shown."
            }
            onRetry={accounts.reload}
          />
        ) : accounts.data.data.length === 0 ? (
          <NothingYet
            title="No accounts yet"
            description="This customer's accounts and their progress appear here."
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="portfolio-accounts">
            {accounts.data.data.map((account) => {
              const share =
                perMille(account.collectedAmount, account.accountAmount) ?? 0;
              return (
                <li key={account.id}>
                  <Card.Root>
                    <Card.Body className="gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/accounts/${account.id}`}
                          className="font-mono text-body font-medium text-accent hover:underline"
                        >
                          {account.accountCode}
                        </Link>
                        <AccountStatusBadge account={account} />
                        <span
                          className="ml-auto text-label text-ink-muted"
                          data-numeric
                        >
                          {formatCurrency(account.dailyAmount)} a day
                        </span>
                      </div>
                      <div className="flex items-center gap-3" data-numeric>
                        <Meter
                          value={share}
                          label={`Collected of ${account.accountCode}`}
                          valueText={formatPerMille(share)}
                          tone={
                            account.status === "COMPLETED"
                              ? "positive"
                              : "accent"
                          }
                          className="h-2"
                        />
                        <span className="shrink-0 text-label text-ink-muted">
                          {formatPerMille(share)}
                        </span>
                      </div>
                      <p className="text-body text-ink-muted" data-numeric>
                        {formatCurrency(account.collectedAmount)} of{" "}
                        {formatCurrency(account.accountAmount)} collected ·
                        Outstanding{" "}
                        <span className="font-medium text-ink">
                          {formatCurrency(account.outstandingAmount)}
                        </span>{" "}
                        ·{" "}
                        {account.actualCompletionDate
                          ? `Completed ${formatBusinessDate(account.actualCompletionDate)}`
                          : `Target ${formatBusinessDate(account.targetCompletionDate)}`}
                      </p>
                      {account.investedAmount !== null &&
                      account.profitAmount !== null ? (
                        <p
                          className="text-caption text-ink-subtle"
                          data-numeric
                        >
                          Invested {formatCurrency(account.investedAmount)} ·
                          Profit {formatCurrency(account.profitAmount)}
                        </p>
                      ) : null}
                    </Card.Body>
                  </Card.Root>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Recent payments" as="h3">
        {recent.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : recent.status !== "ready" ? (
          <LoadFailed
            message={
              recent.status === "error"
                ? recent.message
                : "These payments could not be shown."
            }
            onRetry={recent.reload}
          />
        ) : recent.data.data.length === 0 ? (
          <NothingYet
            title="No payments yet"
            description="Collections appear here as they are recorded."
          />
        ) : (
          <Card.Root>
            <ul
              className="flex flex-col divide-y divide-border"
              data-testid="portfolio-recent"
            >
              {recent.data.data.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 px-4 py-2.5"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-body text-ink" data-numeric>
                      {formatBusinessDate(entry.businessDate)} ·{" "}
                      <span className="font-mono text-label text-ink-muted">
                        {entry.accountCode}
                      </span>
                    </span>
                    <CollectionEntryBadge entry={entry} />
                  </span>
                  <span
                    className="shrink-0 text-body font-medium text-ink"
                    data-numeric
                  >
                    {entry.classification === "NO_PAYMENT" &&
                    entry.entryType === "ORIGINAL"
                      ? "No payment"
                      : formatCurrency(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </Card.Root>
        )}
      </Section>
    </div>
  );
}
