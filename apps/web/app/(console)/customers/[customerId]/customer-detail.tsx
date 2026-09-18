"use client";

import { customerContract } from "@repo/contracts";
import {
  Card,
  Description,
  DescriptionList,
  PageHeader,
  Section,
  Tabs,
} from "@repo/ui";
import Link from "next/link";

import { PageTrail } from "../../../../components/page-trail";
import { RecordFallback } from "../../../../components/query-state";
import { StatusBadge } from "../../../../components/status-badge";
import { formatMobile } from "../../../../lib/format";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { CustomerAccounts } from "../../accounts/account-parts";

export const CUSTOMER_TABS = { tab: "profile" };

/**
 * Customer 360 (S-09): the profile and the customer's accounts, one tab each,
 * with the open tab in the URL (`?tab=`). Collection history joins it with
 * M07; until then the page says so rather than showing an empty list.
 */
export function CustomerDetailView({
  customerId,
  initial,
}: {
  customerId: string;
  initial: Partial<typeof CUSTOMER_TABS>;
}) {
  const me = useSignedIn();
  const { filters, setFilter } = useListState(CUSTOMER_TABS, initial);
  // An unknown `?tab=` opens the profile rather than an empty page.
  const tab = filters.tab === "accounts" ? "accounts" : "profile";
  const customer = useApiQuery(customerContract.getCustomer, {
    params: { customerId },
  });

  if (customer.status !== "ready")
    return <RecordFallback query={customer} noun="Customer" />;

  const record = customer.data;
  const phone = (mobile: string) => (
    <a
      href={`tel:${mobile}`}
      className="hover:text-accent hover:underline"
      data-numeric
    >
      {formatMobile(mobile)}
    </a>
  );

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Customers", href: "/customers" },
              { label: record.name },
            ]}
          />
        }
        title={record.name}
        meta={
          <>
            <span className="font-mono">{record.customerCode}</span>
            <StatusBadge kind="customer" value={record.status} />
          </>
        }
      />

      <Tabs.Root value={tab} onValueChange={(tab) => setFilter("tab", tab)}>
        <Tabs.List aria-label="Customer">
          <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
          <Tabs.Trigger value="accounts">Accounts</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="profile">
          <Section title="Details" as="h3">
            <Card.Root>
              <Card.Body>
                <DescriptionList layout="rows">
                  <Description term="Mobile">
                    {phone(record.mobile)}
                  </Description>
                  <Description term="Alternate mobile">
                    {record.alternateMobile
                      ? phone(record.alternateMobile)
                      : null}
                  </Description>
                  <Description term="Line">
                    <Link
                      href={`/lines/${record.lineId}`}
                      className="hover:text-accent hover:underline"
                    >
                      {record.lineName}
                    </Link>
                  </Description>
                  <Description term="Sector">{record.sectorName}</Description>
                  <Description term="Address">
                    <span className="whitespace-pre-line">
                      {record.address}
                    </span>
                  </Description>
                  {record.notes ? (
                    <Description term="Notes">
                      <span className="whitespace-pre-line">
                        {record.notes}
                      </span>
                    </Description>
                  ) : null}
                </DescriptionList>
              </Card.Body>
            </Card.Root>
          </Section>

          <Section title="Reference persons" as="h3">
            <ul className="grid gap-3 sm:grid-cols-2">
              {record.references.map((reference) => (
                <li key={reference.id}>
                  <Card.Root className="h-full">
                    <Card.Body className="gap-1 text-body">
                      <p className="font-medium text-ink">
                        {reference.name}
                        {reference.relation ? (
                          <span className="font-normal text-ink-muted">
                            {" "}
                            · {reference.relation}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-ink">{phone(reference.mobile)}</p>
                      {reference.address ? (
                        <p className="text-ink-muted">{reference.address}</p>
                      ) : null}
                    </Card.Body>
                  </Card.Root>
                </li>
              ))}
            </ul>
          </Section>
        </Tabs.Content>

        <Tabs.Content value="accounts">
          <Section title="Accounts" as="h3">
            <CustomerAccounts customerId={record.id} role={me.role} />
            <p className="text-body text-ink-muted">
              Collection history appears here once collections are recorded.
            </p>
          </Section>
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}
