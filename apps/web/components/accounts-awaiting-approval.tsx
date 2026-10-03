"use client";

import { accountContract } from "@repo/contracts";
import { formatBusinessDate, formatCurrency, Section } from "@repo/ui";
import Link from "next/link";

import { useApiQuery } from "../lib/use-api-query";

/**
 * Accounts a Senior opened that wait for an Admin or the Super Admin to
 * approve (decided 2026-10-03), on the dashboards of those who can. Nothing
 * at all when none wait, so a quiet day draws no empty section.
 */
export function AccountsAwaitingApproval() {
  const waiting = useApiQuery(accountContract.listAccounts, {
    query: { awaitingApproval: "true", limit: 20 },
  });
  if (waiting.status !== "ready" || waiting.data.data.length === 0) return null;
  const rows = waiting.data.data;
  return (
    <Section
      title={`Accounts waiting for approval · ${rows.length}${waiting.data.hasMore ? "+" : ""}`}
      description="Opened by a Senior. Approve each before it can be disbursed."
    >
      <ul className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised">
        {rows.map((account) => (
          <li key={account.id}>
            <Link
              href={`/accounts/${account.id}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-sunken"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-ink">
                  {account.customerName}
                </span>
                <span className="text-caption text-ink-muted">
                  <span className="font-mono">{account.accountCode}</span> ·{" "}
                  {account.lineName} · from{" "}
                  {formatBusinessDate(account.disbursementDate)}
                </span>
              </span>
              <span className="text-body font-medium text-ink" data-numeric>
                {formatCurrency(account.accountAmount)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
