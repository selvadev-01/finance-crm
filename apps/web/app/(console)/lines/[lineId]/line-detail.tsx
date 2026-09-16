"use client";

import { organisationContract as org, staffContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  buttonClass,
  DataTable,
  DataTableSkeleton,
  formatBusinessDate,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import {
  LIST_LIMIT,
  LoadFailed,
  RecordNotFound,
  Surface,
  TruncatedNote,
} from "../../_organisation/list-controls";
import { AssignDialog } from "../../_organisation/assign-dialog";
import {
  DeactivateDialog,
  RenameDialog,
} from "../../_organisation/organisation-dialogs";
import { StatusBadge } from "../../_organisation/status-badge";

type Open =
  | "rename"
  | "deactivate"
  | "assign-senior"
  | "assign-junior"
  | null;

export function LineDetail({ lineId }: { lineId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [open, setOpen] = useState<Open>(null);

  const line = useApiQuery(org.getLine, { params: { lineId } });
  const sector = useApiQuery(
    org.getSector,
    line.status === "ready" ? { params: { sectorId: line.data.sectorId } } : null,
  );
  const staffing = useApiQuery(org.listLineStaffing, {
    query: { limit: LIST_LIMIT },
  });
  const history = useApiQuery(org.listAssignmentHistory, {
    params: { lineId },
    query: { limit: LIST_LIMIT },
  });
  // Candidates for the assign dialog, and names for lines a move leaves
  // without a Senior. Only an Admin assigns.
  // Filtered by role at the API, so one role can never crowd the other out
  // of a capped page.
  const seniors = useApiQuery(
    staffContract.listStaff,
    manages
      ? { query: { limit: LIST_LIMIT, status: "ACTIVE", role: "SENIOR" } }
      : null,
  );
  const juniors = useApiQuery(
    staffContract.listStaff,
    manages
      ? { query: { limit: LIST_LIMIT, status: "ACTIVE", role: "JUNIOR" } }
      : null,
  );
  const allLines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT, includeInactive: "true" } } : null,
  );

  if (line.status === "loading") {
    return <DataTableSkeleton columns={4} rows={3} />;
  }
  if (line.status === "not-found" || line.status === "not-permitted") {
    return <RecordNotFound noun="Line" />;
  }
  if (line.status === "error") {
    return <LoadFailed message={line.message} onRetry={line.reload} />;
  }

  const record = line.data;
  const today =
    staffing.status === "ready"
      ? staffing.data.data.find((row) => row.lineId === record.id)
      : undefined;
  const sectorName = sector.status === "ready" ? sector.data.name : "Sector";

  const afterChange = () => {
    setOpen(null);
    line.reload();
    staffing.reload();
    history.reload();
    seniors.reload();
    juniors.reload();
  };
  const canAssign =
    manages &&
    record.isActive &&
    seniors.status === "ready" &&
    juniors.status === "ready";
  const candidatesFor = (role: "SENIOR" | "JUNIOR") => {
    const query = role === "SENIOR" ? seniors : juniors;
    return query.status === "ready"
      ? { people: query.data.data, truncated: query.data.hasMore }
      : { people: [], truncated: false };
  };
  const lineNames = new Map(
    allLines.status === "ready"
      ? allLines.data.data.map((each) => [each.id, each.name])
      : [],
  );

  return (
    <>
      <PageHeader
        eyebrow={
          manages ? (
            <Link
              href={`/sectors/${record.sectorId}`}
              className="hover:text-ink hover:underline"
            >
              {sectorName}
            </Link>
          ) : (
            sectorName
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
          <>
            <Link
              href={`/lines/${lineId}/day-closes/${toBusinessDate(new Date())}`}
              className={buttonClass("secondary")}
            >
              Day close
            </Link>
            {manages ? (
            <>
              <Button onClick={() => setOpen("rename")}>Rename</Button>
              {record.isActive ? (
                <Button onClick={() => setOpen("deactivate")}>Deactivate</Button>
              ) : null}
            </>
            ) : null}
          </>
        }
      />

      <section aria-labelledby="line-staff" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="line-staff" className="text-base font-semibold text-ink">
            Staff today
          </h2>
          {canAssign ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpen("assign-senior")}>
                {today?.senior ? "Change Senior" : "Assign Senior"}
              </Button>
              <Button onClick={() => setOpen("assign-junior")}>Add Junior</Button>
            </div>
          ) : null}
        </div>
        {staffing.status === "loading" ? (
          <DataTableSkeleton columns={3} rows={1} />
        ) : staffing.status === "error" ? (
          <LoadFailed message={staffing.message} onRetry={staffing.reload} />
        ) : !record.isActive ? (
          <p className="text-sm text-ink-muted">
            This line is inactive, so no current staffing is shown. Its history
            is below.
          </p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Figure label="Senior">
              {today?.senior ? (
                today.senior.name
              ) : (
                <Badge tone="warning">No Senior assigned</Badge>
              )}
            </Figure>
            <Figure label="Juniors">{today ? today.juniorCount : "—"}</Figure>
            <Figure label="Customers">
              {today ? today.customerCount : "—"}
            </Figure>
          </dl>
        )}
      </section>

      <section aria-labelledby="line-figures" className="flex flex-col gap-3">
        <h2 id="line-figures" className="text-base font-semibold text-ink">
          Collections and money
        </h2>
        <p className="text-sm text-ink-muted">
          Account value, invested amount, profit, and expected and actual daily
          collection appear here once accounts and collections are recorded.
          Until then nothing is shown, rather than zeros.
        </p>
      </section>

      <section aria-labelledby="line-history" className="flex flex-col gap-3">
        <h2 id="line-history" className="text-base font-semibold text-ink">
          Assignment history
        </h2>
        {history.status === "loading" ? <DataTableSkeleton columns={4} rows={3} /> : null}
        {history.status === "error" ? (
          <LoadFailed message={history.message} onRetry={history.reload} />
        ) : null}
        {history.status === "ready" && history.data.data.length === 0 ? (
          <Surface>
            <NothingYet
              title="No one has been assigned"
              description="When a Senior or Junior is assigned to this line, each assignment is kept here with its dates."
            />
          </Surface>
        ) : null}
        {history.status === "ready" && history.data.data.length > 0 ? (
          <>
            <DataTable
              caption="Assignment history"
              rows={history.data.data}
              rowKey={(entry) => entry.id}
              columns={[
                {
                  header: "Staff",
                  cell: (entry) => (
                    <Link
                      href={`/team/${entry.staffProfileId}`}
                      className="font-medium text-ink hover:text-accent hover:underline"
                    >
                      {entry.staffName}
                    </Link>
                  ),
                },
                {
                  header: "Role",
                  cell: (entry) =>
                    entry.assignmentRole === "SENIOR" ? "Senior" : "Junior",
                },
                {
                  header: "From",
                  cell: (entry) => formatBusinessDate(entry.effectiveFrom),
                },
                {
                  header: "To",
                  cell: (entry) =>
                    entry.effectiveTo ? (
                      formatBusinessDate(entry.effectiveTo)
                    ) : (
                      <Badge tone="info">Open</Badge>
                    ),
                },
              ]}
            />
            {history.data.hasMore ? <TruncatedNote noun="assignments" /> : null}
          </>
        ) : null}
      </section>

      {open === "rename" ? (
        <RenameDialog
          open
          target={{ kind: "line", record }}
          onClose={() => setOpen(null)}
          onRenamed={afterChange}
        />
      ) : null}
      {open === "deactivate" ? (
        <DeactivateDialog
          open
          target={{ kind: "line", record }}
          onClose={() => setOpen(null)}
          onDeactivated={afterChange}
        />
      ) : null}
      {(open === "assign-senior" || open === "assign-junior") && canAssign ? (
        <AssignDialog
          target={{
            from: "line",
            line: record,
            role: open === "assign-senior" ? "SENIOR" : "JUNIOR",
            candidates: candidatesFor(
              open === "assign-senior" ? "SENIOR" : "JUNIOR",
            ).people,
            candidatesTruncated: candidatesFor(
              open === "assign-senior" ? "SENIOR" : "JUNIOR",
            ).truncated,
          }}
          lineNames={lineNames}
          onClose={() => setOpen(null)}
          onAssigned={afterChange}
        />
      ) : null}
    </>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-lg font-semibold text-ink" data-numeric>
        {children}
      </dd>
    </div>
  );
}
