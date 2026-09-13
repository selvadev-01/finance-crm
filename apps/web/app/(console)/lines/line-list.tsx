"use client";

import { organisationContract as org } from "@repo/contracts";
import {
  Button,
  DataTableSkeleton,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { LineTable, staffingByLine } from "../_organisation/line-table";
import {
  LIST_LIMIT,
  LoadFailed,
  ShowInactiveToggle,
  Surface,
  TruncatedNote,
} from "../_organisation/list-controls";
import { CreateLineDialog } from "../_organisation/organisation-dialogs";

export function LineList() {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const [sectorId, setSectorId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);

  const lines = useApiQuery(org.listLines, {
    query: {
      limit: LIST_LIMIT,
      includeInactive: showInactive ? "true" : "false",
      ...(sectorId ? { sectorId } : {}),
    },
  });
  const sectors = useApiQuery(org.listSectors, {
    query: { limit: LIST_LIMIT, includeInactive: "true" },
  });
  const staffing = useApiQuery(org.listLineStaffing, {
    query: { limit: LIST_LIMIT },
  });

  const sectorMap =
    sectors.status === "ready"
      ? new Map(sectors.data.data.map((sector) => [sector.id, sector]))
      : new Map();
  const activeSectors =
    sectors.status === "ready"
      ? sectors.data.data.filter((sector) => sector.isActive)
      : [];
  const staffingMap =
    staffing.status === "ready" ? staffingByLine(staffing.data.data) : null;
  const filtered = sectorId !== "" || !showInactive;

  return (
    <>
      <PageHeader
        title={manages ? "Lines" : "Your line"}
        description={
          manages
            ? "Collection routes, with who works each one today."
            : "The line you are assigned to today."
        }
        actions={
          manages ? (
            <Button
              tone="primary"
              onClick={() => setCreating(true)}
              disabled={activeSectors.length === 0}
            >
              New line
            </Button>
          ) : null
        }
      />

      {manages ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-64">
            Sector
            <Select
              value={sectorId}
              onChange={(event) => setSectorId(event.target.value)}
            >
              <option value="">All sectors</option>
              {sectors.status === "ready"
                ? sectors.data.data.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.name}
                      {sector.isActive ? "" : " (inactive)"}
                    </option>
                  ))
                : null}
            </Select>
          </label>
          <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} />
        </div>
      ) : null}

      {lines.status === "loading" ? <DataTableSkeleton columns={6} /> : null}
      {lines.status === "error" ? (
        <LoadFailed message={lines.message} onRetry={lines.reload} />
      ) : null}

      {lines.status === "ready" && lines.data.data.length === 0 ? (
        <Surface>
          {!manages ? (
            <NothingYet
              title="No line assigned to you today"
              description="An Admin assigns Seniors to lines. Once you are assigned, your line appears here."
            />
          ) : filtered && sectorMap.size > 0 ? (
            <NoMatches
              title="No lines match"
              description="No lines for this sector or status. Clear the filter to see every line."
              action={
                <Button
                  onClick={() => {
                    setSectorId("");
                    setShowInactive(true);
                  }}
                >
                  Show all lines
                </Button>
              }
            />
          ) : (
            <NothingYet
              title="No lines yet"
              description={
                activeSectors.length > 0
                  ? "Add the first collection line."
                  : "Lines belong to a sector. Create a sector first."
              }
              action={
                activeSectors.length > 0 ? (
                  <Button tone="primary" onClick={() => setCreating(true)}>
                    New line
                  </Button>
                ) : (
                  <Button tone="primary" onClick={() => router.push("/sectors")}>
                    Go to sectors
                  </Button>
                )
              }
            />
          )}
        </Surface>
      ) : null}

      {lines.status === "ready" && lines.data.data.length > 0 ? (
        <>
          <LineTable
            lines={lines.data.data}
            staffing={staffingMap}
            sectors={sectorMap}
          />
          {lines.data.hasMore ? <TruncatedNote noun="lines" /> : null}
        </>
      ) : null}

      {creating ? (
        <CreateLineDialog
          open
          sectors={activeSectors}
          sectorId={sectorId || undefined}
          onClose={() => setCreating(false)}
          onCreated={(line) => router.push(`/lines/${line.id}`)}
        />
      ) : null}
    </>
  );
}
