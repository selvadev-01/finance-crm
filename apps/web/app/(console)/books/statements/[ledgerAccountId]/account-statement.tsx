"use client";

import { exportContract, statementsContract } from "@repo/contracts";
import {
  EmptyFrame,
  FilterBar,
  formatBusinessDate,
  ListSkeleton,
  NotPermitted,
  PageHeader,
} from "@repo/ui";

import { ExportMenu } from "../../../../../components/export-menu";
import { PageTrail } from "../../../../../components/page-trail";
import { LoadFailed } from "../../../../../components/query-state";
import { canManageOrganisation } from "../../../../../lib/roles";
import { useApiQuery } from "../../../../../lib/use-api-query";
import { useListState } from "../../../../../lib/use-list-state";
import { useSignedIn } from "../../../../../lib/use-me";
import {
  RANGE_FILTERS,
  RangeFields,
  StatementEntries,
  useStatementRange,
} from "../../statement-parts";

/**
 * Books · one ledger account's statement (ADR-0018, US-105), opened from a
 * trial balance row: its opening balance, every entry with the running
 * balance, and its closing balance.
 */
export function AccountStatementView({
  ledgerAccountId,
  initial,
}: {
  ledgerAccountId: string;
  initial: Partial<typeof RANGE_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const { filters, setFilter } = useListState(RANGE_FILTERS, initial);
  const { from, to, today } = useStatementRange(filters);
  const statement = useApiQuery(
    statementsContract.getAccountStatement,
    allowed ? { params: { ledgerAccountId }, query: { from, to } } : null,
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
        trail={
          <PageTrail
            steps={[
              {
                label: "Trial balance",
                href: `/reports/trial-balance?date=${to}`,
              },
              { label: "Statement" },
            ]}
          />
        }
        title={
          statement.status === "ready"
            ? statement.data.account.name
            : "Account statement"
        }
        description="Every entry in this ledger account between the dates, with the balance after each."
        actions={
          <ExportMenu
            route={exportContract.accountStatement}
            params={{ ledgerAccountId }}
            query={{ from, to }}
            disabled={statement.status !== "ready"}
          />
        }
      />
      <FilterBar
        summary={`${formatBusinessDate(from)} – ${formatBusinessDate(to)}`}
      >
        <RangeFields
          from={from}
          to={to}
          today={today}
          onChange={(key, value) => setFilter(key, value)}
        />
      </FilterBar>
      {statement.status === "loading" ? <ListSkeleton columns={5} /> : null}
      {statement.status === "error" ? (
        <LoadFailed message={statement.message} onRetry={statement.reload} />
      ) : null}
      {statement.status === "not-found" ? (
        <EmptyFrame>
          <NotPermitted description="This account does not exist, or is not your business's." />
        </EmptyFrame>
      ) : null}
      {statement.status === "ready" ? (
        <StatementEntries statement={statement.data} chart />
      ) : null}
    </>
  );
}
