"use client";

import {
  customerContract,
  type CustomerSummary,
  organisationContract as org,
} from "@repo/contracts";
import {
  Badge,
  Button,
  buttonClass,
  DataTable,
  DataTableSkeleton,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import {
  LIST_LIMIT,
  LoadFailed,
  Surface,
  TruncatedNote,
} from "../_organisation/list-controls";

/** Display form of an E.164 Indian mobile: +91 98765 43210. */
export function formatMobile(mobile: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(mobile);
  return match ? `+91 ${match[1]} ${match[2]}` : mobile;
}

export function CustomerStatusBadge({
  status,
}: {
  status: CustomerSummary["status"];
}) {
  if (status === "ACTIVE") return <Badge tone="positive">Active</Badge>;
  if (status === "BLACKLISTED") return <Badge tone="critical">Blacklisted</Badge>;
  return <Badge tone="neutral">Inactive</Badge>;
}

export function CustomerList() {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [lineId, setLineId] = useState("");

  const customers = useApiQuery(customerContract.listCustomers, {
    query: { limit: LIST_LIMIT, ...(lineId ? { lineId } : {}) },
  });
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT, includeInactive: "true" } } : null,
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          manages
            ? "Everyone who holds or has held an account."
            : "Customers on your line."
        }
        actions={
          manages ? (
            <Link href="/customers/new" className={buttonClass("primary")}>
              New customer
            </Link>
          ) : null
        }
      />

      {manages ? (
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-64">
          Line
          <Select value={lineId} onChange={(event) => setLineId(event.target.value)}>
            <option value="">All lines</option>
            {lines.status === "ready"
              ? lines.data.data.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name}
                    {line.isActive ? "" : " (inactive)"}
                  </option>
                ))
              : null}
          </Select>
        </label>
      ) : null}

      {customers.status === "loading" ? <DataTableSkeleton columns={4} /> : null}
      {customers.status === "error" ? (
        <LoadFailed message={customers.message} onRetry={customers.reload} />
      ) : null}

      {customers.status === "ready" && customers.data.data.length === 0 ? (
        <Surface>
          {lineId ? (
            <NoMatches
              title="No customers on this line"
              description="Choose another line, or show every line."
              action={<Button onClick={() => setLineId("")}>Show all lines</Button>}
            />
          ) : manages ? (
            <NothingYet
              title="No customers yet"
              description="Onboard the first customer. Each one needs a line and at least one reference person."
              action={
                <Link href="/customers/new" className={buttonClass("primary")}>
                  New customer
                </Link>
              }
            />
          ) : (
            <NothingYet
              title="No customers on your line"
              description="Customers appear here once an Admin onboards them onto your line."
            />
          )}
        </Surface>
      ) : null}

      {customers.status === "ready" && customers.data.data.length > 0 ? (
        <>
          <DataTable
            caption="Customers"
            rows={customers.data.data}
            rowKey={(customer) => customer.id}
            columns={[
              {
                header: "Customer",
                cell: (customer) => (
                  <Link
                    href={`/customers/${customer.id}`}
                    className="flex flex-col font-medium text-ink hover:text-accent hover:underline"
                  >
                    {customer.name}
                    <span className="font-mono text-2xs font-normal text-ink-muted">
                      {customer.customerCode}
                    </span>
                  </Link>
                ),
              },
              {
                header: "Mobile",
                cell: (customer) => (
                  <span data-numeric>{formatMobile(customer.mobile)}</span>
                ),
              },
              { header: "Line", cell: (customer) => customer.lineName },
              {
                header: "Status",
                align: "end",
                cell: (customer) => <CustomerStatusBadge status={customer.status} />,
              },
            ]}
          />
          {customers.data.hasMore ? (
            <TruncatedNote noun="customers" />
          ) : null}
        </>
      ) : null}
    </>
  );
}
