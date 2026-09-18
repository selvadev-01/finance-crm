"use client";

import { customerContract, type CustomerSummary } from "@repo/contracts";
import {
  Button,
  buttonClass,
  DataView,
  FilterBar,
  ListFooter,
  NoMatches,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../components/columns";
import { LineFilter } from "../../../components/line-filter";
import { ListFallback } from "../../../components/list-state";
import { StatusBadge } from "../../../components/status-badge";
import { formatMobile } from "../../../lib/format";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { canManageOrganisation } from "../../../lib/roles";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";

export const CUSTOMER_FILTERS = { line: "" };

/** S-08 · Customers (US-020): paged, so a book of 1,000+ customers is all reachable. */
export function CustomerList({
  initial,
}: {
  initial: Partial<typeof CUSTOMER_FILTERS>;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const { filters, setFilter, reset, filtered } = useListState(
    CUSTOMER_FILTERS,
    initial,
  );
  // Only Admins filter by line; a Senior or Junior already sees just their own.
  const lineId = manages ? filters.line : "";

  const customers = usePagedQuery(customerContract.listCustomers, {
    query: { limit: LIST_LIMIT, ...(lineId ? { lineId } : {}) },
  });

  const newCustomer = manages ? (
    <Link href="/customers/new" className={buttonClass("primary")}>
      New customer
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          manages
            ? "Everyone who holds or has held an account."
            : "Customers on your line."
        }
        actions={newCustomer}
      />

      {manages ? (
        <FilterBar>
          <LineFilter
            value={filters.line}
            onChange={(value) => setFilter("line", value)}
          />
        </FilterBar>
      ) : null}

      {customers.status === "ready" && customers.rows.length > 0 ? (
        <>
          <DataView
            caption="Customers"
            rows={customers.rows}
            getRowId={(customer) => customer.id}
            complete={!customers.hasMore}
            columns={[
              identityColumn<CustomerSummary>({
                header: "Customer",
                name: (customer) => customer.name,
                code: (customer) => customer.customerCode,
                href: (customer) => `/customers/${customer.id}`,
              }),
              valueColumn<CustomerSummary>({
                id: "mobile",
                header: "Mobile",
                value: (customer) => customer.mobile,
                cell: (customer) => (
                  <span data-numeric>{formatMobile(customer.mobile)}</span>
                ),
              }),
              valueColumn<CustomerSummary>({
                id: "line",
                header: "Line",
                value: (customer) => customer.lineName,
              }),
              displayColumn<CustomerSummary>({
                id: "status",
                header: "Status",
                align: "end",
                cell: (customer) => (
                  <StatusBadge kind="customer" value={customer.status} />
                ),
              }),
            ]}
            footer={
              <ListFooter
                shown={customers.rows.length}
                noun={customers.rows.length === 1 ? "customer" : "customers"}
                onMore={customers.loadMore}
                loadingMore={customers.loadingMore}
                note={customers.moreError ?? undefined}
              />
            }
          />
        </>
      ) : (
        <ListFallback
          query={customers}
          columns={4}
          empty={
            manages && filtered ? (
              <NoMatches
                title="No customers on this line"
                description="Choose another line, or show every line."
                action={<Button onClick={reset}>Show all lines</Button>}
              />
            ) : manages ? (
              <NothingYet
                title="No customers yet"
                description="Onboard the first customer. Each one needs a line and at least one reference person."
                action={newCustomer ?? undefined}
              />
            ) : (
              <NothingYet
                title="No customers on your line"
                description="Customers appear here once an Admin onboards them onto your line."
              />
            )
          }
        />
      )}
    </>
  );
}
