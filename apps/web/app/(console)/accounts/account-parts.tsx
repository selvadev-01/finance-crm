"use client";

import { type Account, accountContract, toPaise } from "@repo/contracts";
import {
  Badge,
  buttonClass,
  DataTable,
  DataTableSkeleton,
  formatBusinessDate,
  formatCurrency,
  NothingYet,
} from "@repo/ui";
import Link from "next/link";

import { canManageOrganisation, type Role } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { LIST_LIMIT, LoadFailed, Surface } from "../_organisation/list-controls";

export function AccountStatusBadge({ account }: { account: Pick<Account, "status" | "isOverdue"> }) {
  if (account.status === "ACTIVE") {
    return account.isOverdue ? (
      <Badge tone="warning">Active · overdue</Badge>
    ) : (
      <Badge tone="positive">Active</Badge>
    );
  }
  if (account.status === "PENDING") return <Badge tone="info">Pending</Badge>;
  if (account.status === "COMPLETED") return <Badge tone="neutral">Completed</Badge>;
  return (
    <Badge tone="critical">
      {account.status === "DEFAULTED" ? "Defaulted" : "Written off"}
    </Badge>
  );
}

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
  const accounts = useApiQuery(accountContract.listAccounts, {
    query: { customerId, limit: LIST_LIMIT },
  });
  const manages = canManageOrganisation(role);
  const newAccount = manages ? (
    <Link href={`/accounts/new?customerId=${customerId}`} className={buttonClass("primary")}>
      New account
    </Link>
  ) : null;

  if (accounts.status === "loading") return <DataTableSkeleton columns={4} rows={2} />;
  if (accounts.status === "error") {
    return <LoadFailed message={accounts.message} onRetry={accounts.reload} />;
  }
  if (accounts.status !== "ready") return null;

  const rows = accounts.data.data;
  if (rows.length === 0) {
    return (
      <Surface>
        <NothingYet
          title="No accounts yet"
          description={
            manages
              ? "Create this customer's first account. The schedule is shown before you save."
              : "This customer has no accounts."
          }
          action={newAccount ?? undefined}
        />
      </Surface>
    );
  }

  const open = rows.filter((account) => account.status === "ACTIVE");
  // Summed in exact paise — never a floating-point number (BR-11).
  const openTotalPaise = open.reduce(
    (total, account) => total + toPaise(account.outstandingAmount),
    0n,
  );
  const openTotal = `${openTotalPaise / 100n}.${String(openTotalPaise % 100n).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      {newAccount ? <div className="flex justify-end">{newAccount}</div> : null}
      <DataTable
        caption="Accounts"
        rows={rows}
        rowKey={(account) => account.id}
        columns={[
          {
            header: "Account",
            cell: (account) => (
              <Link
                href={`/accounts/${account.id}`}
                className="font-mono font-medium text-ink hover:text-accent hover:underline"
              >
                {account.accountCode}
              </Link>
            ),
          },
          { header: "Status", cell: (account) => <AccountStatusBadge account={account} /> },
          {
            header: "Amount",
            align: "end",
            cell: (account) => formatCurrency(account.accountAmount),
          },
          {
            header: "Outstanding",
            align: "end",
            cell: (account) => formatCurrency(account.outstandingAmount),
          },
          {
            header: "Target",
            cell: (account) => formatBusinessDate(account.targetCompletionDate),
          },
        ]}
      />
      {open.length > 1 ? (
        <p className="text-right text-sm text-ink" data-numeric>
          Total outstanding, summed across {open.length} active accounts:{" "}
          <span className="font-semibold">{formatCurrency(openTotal)}</span>
        </p>
      ) : null}
    </div>
  );
}
