"use client";

import { type Account, accountContract } from "@repo/contracts";
import {
  buttonClass,
  DataView,
  formatBusinessDate,
  ListFooter,
  NothingYet,
} from "@repo/ui";
import Link from "next/link";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../components/columns";
import { ListFallback } from "../../../components/list-state";
import { Money } from "../../../components/money";
import { AccountStatusBadge } from "../../../components/status-badge";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { sumMoney } from "../../../lib/money";
import { canManageOrganisation, type Role } from "../../../lib/roles";
import { usePagedQuery } from "../../../lib/use-paged-query";

/**
 * A customer's accounts on their profile (S-09): each with its own
 * outstanding, and — when more than one is open — the total **labelled as a sum
 * across accounts** (US-022).
 */
export function CustomerAccounts({
  customerId,
  role,
}: {
  customerId: string;
  role: Role;
}) {
  const accounts = usePagedQuery(accountContract.listAccounts, {
    query: { customerId, limit: LIST_LIMIT },
  });
  const manages = canManageOrganisation(role);
  const newAccount = manages ? (
    <Link
      href={`/accounts/new?customerId=${customerId}`}
      className={buttonClass("primary")}
    >
      New account
    </Link>
  ) : null;

  if (accounts.status !== "ready" || accounts.rows.length === 0) {
    return (
      <ListFallback
        query={accounts}
        columns={5}
        empty={
          <NothingYet
            title="No accounts yet"
            description={
              manages
                ? "Create this customer's first account. The schedule is shown before you save."
                : "This customer has no accounts."
            }
            action={newAccount ?? undefined}
          />
        }
      />
    );
  }

  const rows = accounts.rows;
  const open = rows.filter((account) => account.status === "ACTIVE");
  // Summed in exact paise — never a floating-point number (BR-11). Only once
  // every account is loaded, so the sum is never of a partial list.
  const openTotal = sumMoney(open.map((account) => account.outstandingAmount));

  return (
    <div className="flex flex-col gap-3">
      {newAccount ? <div className="flex justify-end">{newAccount}</div> : null}
      <DataView
        caption="Accounts"
        rows={rows}
        getRowId={(account) => account.id}
        complete={!accounts.hasMore}
        columns={[
          identityColumn<Account>({
            header: "Account",
            name: (account) => account.accountCode,
            href: (account) => `/accounts/${account.id}`,
          }),
          displayColumn<Account>({
            id: "status",
            header: "Status",
            cell: (account) => <AccountStatusBadge account={account} />,
            card: "status",
          }),
          moneyColumn<Account>({
            id: "amount",
            header: "Amount",
            amount: (account) => account.accountAmount,
          }),
          moneyColumn<Account>({
            id: "outstanding",
            header: "Outstanding",
            amount: (account) => account.outstandingAmount,
            card: "headline",
          }),
          valueColumn<Account>({
            id: "target",
            header: "Target",
            value: (account) => account.targetCompletionDate,
            cell: (account) => formatBusinessDate(account.targetCompletionDate),
          }),
        ]}
        footer={
          accounts.hasMore ? (
            <ListFooter
              shown={rows.length}
              noun="accounts"
              onMore={accounts.loadMore}
              loadingMore={accounts.loadingMore}
              note={accounts.moreError ?? undefined}
            />
          ) : null
        }
      />
      {!accounts.hasMore && open.length > 1 ? (
        <p className="text-right text-body text-ink" data-numeric>
          Total outstanding, summed across {open.length} active accounts:{" "}
          <Money amount={openTotal} className="font-semibold" />
        </p>
      ) : null}
    </div>
  );
}
