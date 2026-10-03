"use client";

import { ledgerContract, type TrialBalanceRow as Row } from "@repo/contracts";
import { type CalendarDate, startOfMonth } from "@repo/domain";
import { DataView, formatCurrency, ListSkeleton, Tabs } from "@repo/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { displayColumn, moneyColumn } from "../../../components/columns";
import { LoadFailed } from "../../../components/query-state";
import { subtractMoney } from "../../../lib/money";
import { useApiQuery } from "../../../lib/use-api-query";

type AccountType = Row["accountType"];

/**
 * The two places money sits that no other Ledger tab lists: cash, and what
 * customers still owe. Owner money, profit and expenses have tabs of their
 * own, so they are not repeated here (decided with the owner, 2026-10-04).
 * Simple Books has no bank, so cash is the office and the staff.
 */
const GROUPS = [
  {
    key: "cash",
    title: "Cash",
    description: "Cash at the office and with your collection staff.",
    types: ["CASH_AT_OFFICE", "CASH_IN_HAND"],
    labels: { in: "Money in", out: "Money out", now: "Balance" },
  },
  {
    key: "collect",
    title: "Customer dues",
    description: "What customers still owe on the loans you gave.",
    types: ["LOAN_RECEIVABLE"],
    labels: { in: "Lent", out: "Repaid", now: "Still owed" },
  },
] as const satisfies readonly {
  key: string;
  title: string;
  description: string;
  types: readonly AccountType[];
  labels: { in: string; out: string; now: string };
}[];

type Group = (typeof GROUPS)[number];

/** Cash and loans are both money the business holds: in is a debit. */
const balance = (row: Row) => subtractMoney(row.debits, row.credits);

function accountName(row: Row): string {
  if (row.accountType === "CASH_IN_HAND")
    return `With staff · ${row.ownerName ?? "Former staff"}`;
  if (row.accountType === "LOAN_RECEIVABLE")
    return `Customer loans · ${row.accounts} ${row.accounts === 1 ? "loan" : "loans"}`;
  return "Cash at office";
}

const statementHref = (ledgerAccountId: string, date: CalendarDate) =>
  `/books/statements/${ledgerAccountId}?from=${startOfMonth(date)}&to=${date}`;

type TabKey = Group["key"] | "latest";

/**
 * Cash and customer dues, account by account, from the ledger's own entries
 * up to today (M09 trial balance): what came in, what went out, what is left,
 * and each one's entries — beside the latest entries, as a third tab. Shown
 * on the summary to Admins and above.
 */
export function MoneyAccounts({
  date,
  latest,
}: {
  date: CalendarDate;
  /** The latest entries list, the summary's own. */
  latest: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("cash");
  const ledger = useApiQuery(ledgerContract.getTrialBalance, {
    query: { date },
  });

  return (
    <section aria-label="Cash, customer dues and latest entries">
      <Tabs.Root value={tab} onValueChange={(next) => setTab(next as TabKey)}>
        <Tabs.List aria-label="Cash, customer dues and latest entries">
          {GROUPS.map((group) => (
            <Tabs.Trigger key={group.key} value={group.key}>
              {group.title}
            </Tabs.Trigger>
          ))}
          <Tabs.Trigger value="latest">Latest entries</Tabs.Trigger>
        </Tabs.List>
        {GROUPS.map((group) => (
          <Tabs.Content
            key={group.key}
            value={group.key}
            className="flex flex-col gap-3 pt-3"
          >
            <p className="text-body text-ink-muted">{group.description}</p>
            {ledger.status === "loading" ? (
              <ListSkeleton columns={4} rows={3} />
            ) : null}
            {ledger.status === "error" ? (
              <LoadFailed message={ledger.message} onRetry={ledger.reload} />
            ) : null}
            {ledger.status === "ready" ? (
              <GroupTable
                group={group}
                rows={ledger.data.rows.filter((row) =>
                  (group.types as readonly AccountType[]).includes(
                    row.accountType,
                  ),
                )}
                date={date}
              />
            ) : null}
          </Tabs.Content>
        ))}
        <Tabs.Content value="latest" className="flex flex-col gap-3 pt-3">
          <p className="text-body text-ink-muted">
            The newest money movements this month.
          </p>
          {latest}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

function GroupTable({
  group,
  rows,
  date,
}: {
  group: Group;
  rows: Row[];
  date: CalendarDate;
}) {
  if (rows.length === 0)
    return <p className="text-body text-ink-muted">Nothing here yet.</p>;
  return (
    <DataView
      caption={group.title}
      rows={rows}
      getRowId={(row) => `${row.accountType}:${row.ownerUserId ?? ""}`}
      complete
      columns={[
        displayColumn<Row>({
          id: "account",
          header: "Account",
          card: "headline",
          cell: (row) => (
            <span className="font-medium text-ink">{accountName(row)}</span>
          ),
        }),
        moneyColumn<Row>({
          id: "in",
          header: group.labels.in,
          amount: (row) => row.debits,
        }),
        moneyColumn<Row>({
          id: "out",
          header: group.labels.out,
          amount: (row) => row.credits,
        }),
        moneyColumn<Row>({
          id: "now",
          header: group.labels.now,
          amount: balance,
          render: (row) => (
            <span className="font-medium text-ink">
              {formatCurrency(balance(row))}
            </span>
          ),
        }),
        displayColumn<Row>({
          id: "entries",
          header: "Entries",
          align: "end",
          cell: (row) =>
            row.ledgerAccountId ? (
              <Link
                href={statementHref(row.ledgerAccountId, date)}
                className="whitespace-nowrap text-label text-accent underline-offset-2 hover:underline"
              >
                View entries ›
              </Link>
            ) : (
              <span className="text-caption text-ink-muted">
                On each loan's page
              </span>
            ),
        }),
      ]}
    />
  );
}
