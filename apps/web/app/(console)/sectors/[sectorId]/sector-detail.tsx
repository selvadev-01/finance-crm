"use client";

import { organisationContract as org } from "@repo/contracts";
import { Button, ListFooter, NothingYet, PageHeader, Section } from "@repo/ui";
import { useState } from "react";

import { ListFallback } from "../../../../components/list-state";
import { PageTrail } from "../../../../components/page-trail";
import { RecordFallback } from "../../../../components/query-state";
import { ActivityBadge } from "../../../../components/status-badge";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { LineTable, staffingByLine } from "../../_organisation/line-table";
import {
  CreateLineDialog,
  DeactivateDialog,
  RenameDialog,
} from "../../_organisation/organisation-dialogs";

type Open = "rename" | "deactivate" | "new-line" | null;

/** A sector and its lines (US-010, US-011). */
export function SectorDetail({ sectorId }: { sectorId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [open, setOpen] = useState<Open>(null);

  const sector = useApiQuery(org.getSector, { params: { sectorId } });
  const lines = usePagedQuery(org.listLines, {
    query: { sectorId, includeInactive: "true", limit: LIST_LIMIT },
  });
  const staffing = useApiQuery(org.listLineStaffing, {
    query: { limit: LIST_LIMIT },
  });
  const staffingMap =
    staffing.status === "ready" ? staffingByLine(staffing.data.data) : null;

  if (sector.status !== "ready")
    return <RecordFallback query={sector} noun="Sector" />;

  const record = sector.data;
  const afterChange = () => {
    setOpen(null);
    sector.reload();
    lines.reload();
    staffing.reload();
  };
  const newLine =
    manages && record.isActive ? (
      <Button tone="primary" onClick={() => setOpen("new-line")}>
        New line
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={
              manages
                ? [
                    { label: "Sectors", href: "/sectors" },
                    { label: record.name },
                  ]
                : [{ label: "Sector" }]
            }
          />
        }
        title={record.name}
        meta={
          <>
            <span className="font-mono">{record.code}</span>
            <ActivityBadge isActive={record.isActive} />
          </>
        }
        actions={
          manages ? (
            <>
              <Button onClick={() => setOpen("rename")}>Rename</Button>
              {record.isActive ? (
                <Button tone="danger" onClick={() => setOpen("deactivate")}>
                  Deactivate
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <Section title="Lines" actions={newLine}>
        {lines.status === "ready" && lines.rows.length > 0 ? (
          <LineTable
            lines={lines.rows}
            staffing={staffingMap}
            complete={!lines.hasMore}
            footer={
              <ListFooter
                shown={lines.rows.length}
                noun={lines.rows.length === 1 ? "line" : "lines"}
                onMore={lines.loadMore}
                loadingMore={lines.loadingMore}
              />
            }
          />
        ) : (
          <ListFallback
            query={lines}
            columns={5}
            empty={
              <NothingYet
                title="No lines in this sector"
                description={
                  record.isActive
                    ? "Add the collection lines that belong to this sector."
                    : "This sector is inactive, so it takes no new lines."
                }
                action={newLine ?? undefined}
              />
            }
          />
        )}
      </Section>

      {open === "rename" ? (
        <RenameDialog
          open
          target={{ kind: "sector", record }}
          onClose={() => setOpen(null)}
          onRenamed={afterChange}
        />
      ) : null}
      {open === "deactivate" ? (
        <DeactivateDialog
          open
          target={{ kind: "sector", record }}
          onClose={() => setOpen(null)}
          onDeactivated={afterChange}
        />
      ) : null}
      {open === "new-line" ? (
        <CreateLineDialog
          open
          sectors={[record]}
          sectorId={record.id}
          onClose={() => setOpen(null)}
          onCreated={afterChange}
        />
      ) : null}
    </>
  );
}
