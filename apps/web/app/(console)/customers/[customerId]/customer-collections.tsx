"use client";

import { collectionContract, type CollectionListItem } from "@repo/contracts";
import { DataView, formatBusinessDate, NothingYet } from "@repo/ui";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ListFallback } from "../../../../components/list-state";
import { Pager } from "../../../../components/pager";
import { StatusBadge } from "../../../../components/status-badge";
import { canManageOrganisation, type Role } from "../../../../lib/roles";
import { usePagedQuery } from "../../../../lib/use-paged-query";

/**
 * US-022 · Customer 360's collection history: every account this customer
 * holds, newest first, not date-bounded as the S-16 list is. An adjustment
 * (US-044) is a row of its own with a signed amount — collections are never
 * edited, so the correction sits beside what it corrects.
 */
export function CustomerCollections({
  customerId,
  role,
}: {
  customerId: string;
  role: Role;
}) {
  // No `url`: this list shares the Customer 360 page with the portfolio's
  // own list, and one set of page params cannot serve both.
  const entries = usePagedQuery(collectionContract.listCustomerCollections, {
    params: { customerId },
  });
  const manages = canManageOrganisation(role);

  if (entries.status !== "ready" || entries.rows.length === 0) {
    return (
      <ListFallback
        query={entries}
        columns={5}
        empty={
          <NothingYet
            title="No collections yet"
            description="Collections appear here as they are recorded on this customer's accounts."
          />
        }
      />
    );
  }

  return (
    <DataView
      caption="Collections"
      rows={entries.rows}
      getRowId={(entry) => entry.id}
      complete={entries.pageCount <= 1}
      columns={[
        identityColumn<CollectionListItem>({
          header: "Account",
          name: (entry) => entry.accountCode,
          href: (entry) =>
            `/collections/${entry.adjustsCollectionId ?? entry.id}`,
        }),
        valueColumn<CollectionListItem>({
          id: "date",
          header: "Date",
          value: (entry) => entry.businessDate,
          cell: (entry) => formatBusinessDate(entry.businessDate),
        }),
        ...(manages
          ? [
              valueColumn<CollectionListItem>({
                id: "line",
                header: "Line",
                // Frozen at write: the line that collected it (BR-15).
                value: (entry) => entry.lineName,
              }),
            ]
          : []),
        valueColumn<CollectionListItem>({
          id: "collectedBy",
          header: "Collected by",
          value: (entry) => entry.collectedByName,
        }),
        moneyColumn<CollectionListItem>({
          id: "amount",
          header: "Amount",
          amount: (entry) => entry.amount,
          card: "headline",
        }),
        displayColumn<CollectionListItem>({
          id: "classification",
          header: "Variance",
          align: "end",
          card: "status",
          cell: (entry) => (
            <StatusBadge kind="classification" value={entry.classification} />
          ),
        }),
      ]}
      footer={
        <Pager list={entries} noun="collections" nounSingular="collection" />
      }
    />
  );
}
