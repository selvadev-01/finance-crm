"use client";

import { type Account, accountContract } from "@repo/contracts";
import {
  buttonClass,
  DataView,
  formatBusinessDate,
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
import { Pager } from "../../../components/pager";
import { AccountStatusBadge } from "../../../components/status-badge";
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
  // No `url`: the Customer 360 page carries this list and the collection
  // history, and one set of page params cannot serve both.
  const accounts = usePagedQuery(accountContract.listAccounts, {
    query: { customerId },
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
  // Summed in exact paise — never a floating-point number (BR-11). Only when
  // one page holds every account, so the sum is never of a partial list: a
  // "total outstanding" that silently means "of the ten on this page" is
  // worse than no total at all.
  const openTotal = sumMoney(open.map((account) => account.outstandingAmount));
  const wholePortfolio = accounts.pageCount <= 1;

  return (
    <div className="flex flex-col gap-3">
      {newAccount ? <div className="flex justify-end">{newAccount}</div> : null}
      <DataView
        caption="Accounts"
        rows={rows}
        getRowId={(account) => account.id}
        complete={wholePortfolio}
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
          <Pager list={accounts} noun="accounts" nounSingular="account" />
        }
      />
      {wholePortfolio && open.length > 1 ? (
        <p className="text-right text-body text-ink" data-numeric>
          Total outstanding, summed across {open.length} active accounts:{" "}
          <Money amount={openTotal} className="font-semibold" />
        </p>
      ) : null}
    </div>
  );
}
