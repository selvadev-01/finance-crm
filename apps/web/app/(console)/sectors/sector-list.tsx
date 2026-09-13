"use client";

import { organisationContract as org, type Sector } from "@repo/contracts";
import {
  Button,
  DataTable,
  DataTableSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import {
  LIST_LIMIT,
  LoadFailed,
  ShowInactiveToggle,
  Surface,
  TruncatedNote,
} from "../_organisation/list-controls";
import { CreateSectorDialog } from "../_organisation/organisation-dialogs";
import { StatusBadge } from "../_organisation/status-badge";

export function SectorList() {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);

  // Not read at all for a role that is not shown this screen.
  const sectors = useApiQuery(
    org.listSectors,
    manages
      ? {
          query: {
            limit: LIST_LIMIT,
            includeInactive: showInactive ? "true" : "false",
          },
        }
      : null,
  );
  // Active lines per sector, for the count column.
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT } } : null,
  );

  const lineCount = (sector: Sector) => {
    if (lines.status !== "ready" || lines.data.hasMore) return "—";
    return lines.data.data.filter((line) => line.sectorId === sector.id).length;
  };

  if (!manages) {
    return (
      <Surface>
        <NotPermitted />
      </Surface>
    );
  }

  return (
    <>
      <PageHeader
        title="Sectors"
        description="Areas of the business. Each sector groups its lines."
        actions={
          <Button tone="primary" onClick={() => setCreating(true)}>
            New sector
          </Button>
        }
      />

      <div className="flex items-center justify-end">
        <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} />
      </div>

      {sectors.status === "loading" ? <DataTableSkeleton columns={3} /> : null}
      {sectors.status === "error" ? (
        <LoadFailed message={sectors.message} onRetry={sectors.reload} />
      ) : null}
      {sectors.status === "not-found" || sectors.status === "not-permitted" ? (
        <Surface>
          <NotPermitted />
        </Surface>
      ) : null}

      {sectors.status === "ready" && sectors.data.data.length === 0 ? (
        <Surface>
          <NothingYet
            title={showInactive ? "No sectors yet" : "No active sectors"}
            description={
              showInactive
                ? "Create the first sector, then add its lines."
                : "Create a sector, or show inactive ones to see those that were closed."
            }
            action={
              <Button tone="primary" onClick={() => setCreating(true)}>
                New sector
              </Button>
            }
          />
        </Surface>
      ) : null}

      {sectors.status === "ready" && sectors.data.data.length > 0 ? (
        <>
          <DataTable
            caption="Sectors"
            rows={sectors.data.data}
            rowKey={(sector) => sector.id}
            columns={[
              {
                header: "Sector",
                cell: (sector) => (
                  <Link
                    href={`/sectors/${sector.id}`}
                    className="flex flex-col font-medium text-ink hover:text-accent hover:underline"
                  >
                    {sector.name}
                    <span className="font-mono text-2xs font-normal text-ink-muted">
                      {sector.code}
                    </span>
                  </Link>
                ),
              },
              {
                header: "Active lines",
                align: "end",
                cell: (sector) => lineCount(sector),
              },
              {
                header: "Status",
                align: "end",
                cell: (sector) => <StatusBadge isActive={sector.isActive} />,
              },
            ]}
          />
          {sectors.data.hasMore ? <TruncatedNote noun="sectors" /> : null}
        </>
      ) : null}

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
