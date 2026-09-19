"use client";

import { organisationContract as org, type Sector } from "@repo/contracts";
import {
  Button,
  FilterBar,
  FilterField,
  ListFooter,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ListFallback } from "../../../components/list-state";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";
import { LineTable, staffingByLine } from "../_organisation/line-table";
import { ShowInactiveToggle } from "../_organisation/list-controls";
import { CreateLineDialog } from "../_organisation/organisation-dialogs";

export const LINE_FILTERS = { sectorId: "", inactive: "" };

/** S-12 · Lines (US-011, US-014): collection routes and who works them today. */
export function LineList({
  initial,
}: {
  initial: Partial<typeof LINE_FILTERS>;
}) {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const [creating, setCreating] = useState(false);
  const { filters, setFilter, setFilters } = useListState(
    LINE_FILTERS,
    initial,
  );
  // A Senior sees their own line and no filters.
  const sectorId = manages ? filters.sectorId : "";
  const showInactive = manages && filters.inactive === "show";

  const lines = usePagedQuery(org.listLines, {
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
      : new Map<string, Sector>();
  const activeSectors =
    sectors.status === "ready"
      ? sectors.data.data.filter((sector) => sector.isActive)
      : [];
  const staffingMap =
    staffing.status === "ready" ? staffingByLine(staffing.data.data) : null;

  const newLine =
    activeSectors.length > 0 ? (
      <Button tone="primary" onClick={() => setCreating(true)}>
        New line
      </Button>
    ) : (
      <Button tone="primary" onClick={() => router.push("/sectors")}>
        Go to sectors
      </Button>
    );

  const empty = !manages ? (
    <NothingYet
      title="No line assigned to you today"
      description="An Admin assigns Seniors to lines. Once you are assigned, your line appears here."
    />
  ) : sectorId !== "" && sectorMap.size > 0 ? (
    <NoMatches
      title="No lines match"
      description="No lines for this sector. Show every line to see the other sectors’."
      action={
        <Button
          tone="secondary"
          onClick={() => setFilters({ sectorId: "", inactive: "show" })}
        >
          Show all lines
        </Button>
      }
    />
  ) : !showInactive && sectorMap.size > 0 ? (
    <NoMatches
      title="No active lines"
      description="Inactive lines are hidden. Show them to see lines that were closed."
      action={
        <Button tone="secondary" onClick={() => setFilter("inactive", "show")}>
          Show inactive lines
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
      action={newLine}
    />
  );

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
        <FilterBar
          summary={
            (sectorId && sectors.status === "ready"
              ? (sectors.data.data.find((sector) => sector.id === sectorId)
                  ?.name ?? "One sector")
              : "All sectors") + (showInactive ? ", inactive shown" : "")
          }
          actions={
            <ShowInactiveToggle
              checked={showInactive}
              onChange={(checked) =>
                setFilter("inactive", checked ? "show" : "")
              }
            />
          }
        >
          <FilterField label="Sector" width="lg">
            <Select
              value={sectorId}
              onChange={(event) => setFilter("sectorId", event.target.value)}
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
          </FilterField>
        </FilterBar>
      ) : null}

      {lines.status === "ready" && lines.rows.length > 0 ? (
        <LineTable
          lines={lines.rows}
          staffing={staffingMap}
          sectors={sectorMap}
          complete={!lines.hasMore}
          footer={
            <ListFooter
              shown={lines.rows.length}
              noun={lines.rows.length === 1 ? "line" : "lines"}
              onMore={lines.loadMore}
              loadingMore={lines.loadingMore}
              note={lines.moreError ?? undefined}
            />
          }
        />
      ) : (
        <ListFallback query={lines} columns={6} empty={empty} />
      )}

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
