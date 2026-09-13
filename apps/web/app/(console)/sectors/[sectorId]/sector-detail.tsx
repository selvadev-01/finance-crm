"use client";

import { organisationContract as org } from "@repo/contracts";
import {
  Button,
  DataTableSkeleton,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { LineTable, staffingByLine } from "../../_organisation/line-table";
import {
  LIST_LIMIT,
  LoadFailed,
  RecordNotFound,
  Surface,
  TruncatedNote,
} from "../../_organisation/list-controls";
import {
  CreateLineDialog,
  DeactivateDialog,
  RenameDialog,
} from "../../_organisation/organisation-dialogs";
import { StatusBadge } from "../../_organisation/status-badge";

type Open = "rename" | "deactivate" | "new-line" | null;

export function SectorDetail({ sectorId }: { sectorId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [open, setOpen] = useState<Open>(null);

  const sector = useApiQuery(org.getSector, { params: { sectorId } });
  const lines = useApiQuery(org.listLines, {
    query: { sectorId, includeInactive: "true", limit: LIST_LIMIT },
  });
  const staffing = useApiQuery(org.listLineStaffing, {
    query: { limit: LIST_LIMIT },
  });
  const staffingMap =
    staffing.status === "ready" ? staffingByLine(staffing.data.data) : null;

  if (sector.status === "loading") {
    return <DataTableSkeleton columns={4} rows={3} />;
  }
  if (sector.status === "not-found" || sector.status === "not-permitted") {
    return <RecordNotFound noun="Sector" />;
  }
  if (sector.status === "error") {
    return <LoadFailed message={sector.message} onRetry={sector.reload} />;
  }

  const record = sector.data;
  const afterChange = () => {
    setOpen(null);
    sector.reload();
    lines.reload();
    staffing.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow={
          manages ? (
            <Link href="/sectors" className="hover:text-ink hover:underline">
              Sectors
            </Link>
          ) : (
            "Sector"
          )
        }
        title={record.name}
        description={
          <span className="flex items-center gap-2">
            <span className="font-mono">{record.code}</span>
            <StatusBadge isActive={record.isActive} />
          </span>
        }
        actions={
          manages ? (
            <>
              <Button onClick={() => setOpen("rename")}>Rename</Button>
              {record.isActive ? (
                <Button onClick={() => setOpen("deactivate")}>Deactivate</Button>
              ) : null}
            </>
          ) : null
        }
      />

      <section aria-labelledby="sector-lines" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sector-lines" className="text-base font-semibold text-ink">
            Lines
          </h2>
          {manages && record.isActive ? (
            <Button tone="primary" onClick={() => setOpen("new-line")}>
              New line
            </Button>
          ) : null}
        </div>

        {lines.status === "loading" ? <DataTableSkeleton columns={5} rows={3} /> : null}
        {lines.status === "error" ? (
          <LoadFailed message={lines.message} onRetry={lines.reload} />
        ) : null}
        {lines.status === "ready" && lines.data.data.length === 0 ? (
          <Surface>
            <NothingYet
              title="No lines in this sector"
              description={
                record.isActive
                  ? "Add the collection lines that belong to this sector."
                  : "This sector is inactive, so it takes no new lines."
              }
              action={
                manages && record.isActive ? (
                  <Button tone="primary" onClick={() => setOpen("new-line")}>
                    New line
                  </Button>
                ) : undefined
              }
            />
          </Surface>
        ) : null}
        {lines.status === "ready" && lines.data.data.length > 0 ? (
          <>
            <LineTable lines={lines.data.data} staffing={staffingMap} />
            {lines.data.hasMore ? <TruncatedNote noun="lines" /> : null}
          </>
        ) : null}
      </section>

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
