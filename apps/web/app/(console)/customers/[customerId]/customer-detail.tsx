"use client";

import { customerContract } from "@repo/contracts";
import { DataTableSkeleton, PageHeader } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { CustomerAccounts } from "../../accounts/account-parts";
import {
  LoadFailed,
  RecordNotFound,
} from "../../_organisation/list-controls";
import { CustomerStatusBadge, formatMobile } from "../customer-list";

/**
 * The profile half of Customer 360 (S-09). Accounts, outstanding and
 * collection history join it with M05 and M07; until then the page says so
 * rather than showing an empty balance.
 */
export function CustomerDetailView({ customerId }: { customerId: string }) {
  const me = useSignedIn();
  const customer = useApiQuery(customerContract.getCustomer, {
    params: { customerId },
  });

  if (customer.status === "loading") {
    return <DataTableSkeleton columns={3} rows={3} />;
  }
  if (customer.status === "not-found" || customer.status === "not-permitted") {
    return <RecordNotFound noun="Customer" />;
  }
  if (customer.status === "error") {
    return <LoadFailed message={customer.message} onRetry={customer.reload} />;
  }

  const record = customer.data;
  const phone = (mobile: string) => (
    <a href={`tel:${mobile}`} className="hover:text-accent hover:underline" data-numeric>
      {formatMobile(mobile)}
    </a>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/customers" className="hover:text-ink hover:underline">
            Customers
          </Link>
        }
        title={record.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{record.customerCode}</span>
            <CustomerStatusBadge status={record.status} />
          </span>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Mobile">{phone(record.mobile)}</Detail>
        <Detail label="Alternate mobile">
          {record.alternateMobile ? phone(record.alternateMobile) : "—"}
        </Detail>
        <Detail label="Line">
          <Link href={`/lines/${record.lineId}`} className="hover:text-accent hover:underline">
            {record.lineName}
          </Link>
        </Detail>
        <Detail label="Sector">{record.sectorName}</Detail>
        <Detail label="Address" wide>
          <span className="whitespace-pre-line">{record.address}</span>
        </Detail>
        {record.notes ? (
          <Detail label="Notes" wide>
            <span className="whitespace-pre-line">{record.notes}</span>
          </Detail>
        ) : null}
      </dl>

      <section aria-labelledby="customer-references" className="flex flex-col gap-3">
        <h2 id="customer-references" className="text-base font-semibold text-ink">
          Reference persons
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {record.references.map((reference) => (
            <li
              key={reference.id}
              className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3 text-sm"
            >
              <p className="font-medium text-ink">
                {reference.name}
                {reference.relation ? (
                  <span className="font-normal text-ink-muted"> · {reference.relation}</span>
                ) : null}
              </p>
              <p className="text-ink">{phone(reference.mobile)}</p>
              {reference.address ? (
                <p className="text-ink-muted">{reference.address}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="customer-accounts" className="flex flex-col gap-3">
        <h2 id="customer-accounts" className="text-base font-semibold text-ink">
          Accounts
        </h2>
        <CustomerAccounts customerId={record.id} role={me.role} />
        <p className="text-sm text-ink-muted">
          Collection history appears here once collections are recorded.
        </p>
      </section>
    </>
  );
}

function Detail({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={
        "flex min-w-0 flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3" +
        (wide ? " sm:col-span-2" : "")
      }
    >
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
