"use client";

import { organisationContract as org, type Sector } from "@repo/contracts";
import {
  Button,
  buttonClass,
  DataView,
  EmptyFrame,
  FilterBar,
  NothingYet,
  NotPermitted,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../components/columns";
import { ListFallback } from "../../../components/list-state";
import { Pager } from "../../../components/pager";
import { ActivityBadge } from "../../../components/status-badge";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";
import { ShowInactiveToggle } from "../_organisation/list-controls";
import { CreateSectorDialog } from "../_organisation/organisation-dialogs";

export const SECTOR_FILTERS = { inactive: "" };

/** S-13 · Sectors (US-010): the areas of the business, each with its lines. */
export function SectorList({
  initial,
}: {
  initial: Partial<typeof SECTOR_FILTERS>;
}) {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const [creating, setCreating] = useState(false);
  const { filters, setFilter } = useListState(SECTOR_FILTERS, initial);
  const showInactive = filters.inactive === "show";

  // Not read at all for a role that is not shown this screen.
  const sectors = usePagedQuery(
    org.listSectors,
    manages
      ? {
          query: { includeInactive: showInactive ? "true" : "false" },
        }
      : null,
    { url: true },
  );
  // Active lines per sector, for the count column.
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT } } : null,
  );
  const lineCount = (sector: Sector): number | null =>
    lines.status === "ready" && !lines.data.hasMore
      ? lines.data.data.filter((line) => line.sectorId === sector.id).length
      : null;

  if (!manages) {
    return (
      <EmptyFrame>
        <NotPermitted />
      </EmptyFrame>
    );
  }

  const newSector = (
    <Button tone="primary" onClick={() => setCreating(true)}>
      New sector
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Sectors"
        description="Areas of the business. Each sector groups its lines."
        actions={
          <>
            <Link
              href="/dashboard/sectors"
              className={buttonClass("secondary")}
            >
              Compare sectors
            </Link>
            {newSector}
          </>
        }
      />

      <FilterBar
        actions={
          <ShowInactiveToggle
            checked={showInactive}
            onChange={(checked) => setFilter("inactive", checked ? "show" : "")}
          />
        }
      />

      {sectors.status === "ready" && sectors.rows.length > 0 ? (
        <DataView
          caption="Sectors"
          rows={sectors.rows}
          getRowId={(sector) => sector.id}
          complete={sectors.pageCount <= 1}
          columns={[
            identityColumn<Sector>({
              header: "Sector",
              name: (sector) => sector.name,
              code: (sector) => sector.code,
              href: (sector) => `/sectors/${sector.id}`,
            }),
            valueColumn<Sector>({
              id: "lines",
              header: "Active lines",
              align: "end",
              value: (sector) => lineCount(sector) ?? -1,
              cell: (sector) => lineCount(sector) ?? "—",
            }),
            displayColumn<Sector>({
              id: "status",
              header: "Status",
              align: "end",
              card: "status",
              cell: (sector) => <ActivityBadge isActive={sector.isActive} />,
            }),
          ]}
          footer={<Pager list={sectors} noun="sectors" nounSingular="sector" />}
        />
      ) : (
        <ListFallback
          query={sectors}
          columns={3}
          empty={
            <NothingYet
              title={showInactive ? "No sectors yet" : "No active sectors"}
              description={
                showInactive
                  ? "Create the first sector, then add its lines."
                  : "Create a sector, or show inactive ones to see those that were closed."
              }
              action={newSector}
            />
          }
        />
      )}

      {creating ? (
        <CreateSectorDialog
          open
          onClose={() => setCreating(false)}
          onCreated={(sector) => router.push(`/sectors/${sector.id}`)}
        />
      ) : null}
    </>
  );
}
