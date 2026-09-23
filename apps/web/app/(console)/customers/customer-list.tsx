"use client";

import { customerContract, type CustomerSummary } from "@repo/contracts";
import {
  Button,
  buttonClass,
  DataView,
  FilterBar,
  FilterField,
  Input,
  NoMatches,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../components/columns";
import { LineFilter } from "../../../components/line-filter";
import { ListFallback } from "../../../components/list-state";
import { Pager } from "../../../components/pager";
import { StatusBadge } from "../../../components/status-badge";
import { formatMobile } from "../../../lib/format";
import { canManageOrganisation } from "../../../lib/roles";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";

export const CUSTOMER_FILTERS = { q: "", line: "" };

/** Long enough to type a name without a request per keystroke. */
const SEARCH_DELAY_MS = 300;

/**
 * S-08 · Customers (US-020): paged, so a book of 1,000+ customers is all
 * reachable, and searched by name, code or mobile (US-024) within the
 * caller's own scope — the API applies it, so a Senior finds only their line.
 */
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
  const [searchText, setSearchText] = useState(filters.q);

  // The URL (and the query) follow the box once typing settles.
  useEffect(() => {
    const q = searchText.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => setFilter("q", q), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, setFilter]);

  const customers = usePagedQuery(
    customerContract.listCustomers,
    {
      query: {
        ...(filters.q ? { q: filters.q } : {}),
        ...(lineId ? { lineId } : {}),
      },
    },
    { url: true },
  );

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

      <FilterBar
        summary={[
          filters.q ? `“${filters.q}”` : null,
          manages ? (filters.line ? "One line" : "All lines") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <FilterField label="Search" width="lg">
          <Input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Name, code or mobile"
            autoComplete="off"
            maxLength={80}
          />
        </FilterField>
        {manages ? (
          <LineFilter
            value={filters.line}
            onChange={(value) => setFilter("line", value)}
          />
        ) : null}
      </FilterBar>

      {customers.status === "ready" && customers.rows.length > 0 ? (
        <>
          <DataView
            caption="Customers"
            rows={customers.rows}
            getRowId={(customer) => customer.id}
            complete={customers.pageCount <= 1}
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
                card: "status",
                cell: (customer) => (
                  <StatusBadge kind="customer" value={customer.status} />
                ),
              }),
            ]}
            footer={
              <Pager
                list={customers}
                noun="customers"
                nounSingular="customer"
              />
            }
          />
        </>
      ) : (
        <ListFallback
          query={customers}
          columns={4}
          empty={
            filtered ? (
              <NoMatches
                title={
                  filters.q
                    ? `No customers match “${filters.q}”`
                    : "No customers on this line"
                }
                description={
                  filters.q
                    ? "Search by part of a name, or a whole customer code or mobile number."
                    : "Choose another line, or show every line."
                }
                action={
                  <Button
                    onClick={() => {
                      setSearchText("");
                      reset();
                    }}
                  >
                    Clear filters
                  </Button>
                }
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
