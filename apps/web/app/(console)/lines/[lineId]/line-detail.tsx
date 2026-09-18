"use client";

import {
  type AssignmentHistoryEntry,
  organisationContract as org,
  staffContract,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  buttonClass,
  DataView,
  formatBusinessDate,
  ListFooter,
  NothingYet,
  PageHeader,
  Section,
  Skeleton,
  Stat,
  StatGrid,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { identityColumn, valueColumn } from "../../../../components/columns";
import { ListFallback } from "../../../../components/list-state";
import { PageTrail } from "../../../../components/page-trail";
import { LoadFailed, RecordFallback } from "../../../../components/query-state";
import { ActivityBadge } from "../../../../components/status-badge";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { canManageOrganisation, ROLE_LABEL } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { AssignDialog } from "../../_organisation/assign-dialog";
import {
  DeactivateDialog,
  RenameDialog,
} from "../../_organisation/organisation-dialogs";

type Open = "rename" | "deactivate" | "assign-senior" | "assign-junior" | null;

/** A line: today's staff and its assignment history (US-011, US-014, US-015). */
export function LineDetail({ lineId }: { lineId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [open, setOpen] = useState<Open>(null);

  const line = useApiQuery(org.getLine, { params: { lineId } });
  const sector = useApiQuery(
    org.getSector,
    line.status === "ready"
      ? { params: { sectorId: line.data.sectorId } }
      : null,
  );
  const staffing = useApiQuery(org.listLineStaffing, {
    query: { limit: LIST_LIMIT },
  });
  const history = usePagedQuery(org.listAssignmentHistory, {
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

  if (line.status !== "ready")
    return <RecordFallback query={line} noun="Line" />;

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
        trail={
          <PageTrail
            steps={
              manages
                ? [
                    { label: "Sectors", href: "/sectors" },
                    { label: sectorName, href: `/sectors/${record.sectorId}` },
                    { label: record.name },
                  ]
                : [{ label: sectorName }, { label: record.name }]
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
                  <Button tone="danger" onClick={() => setOpen("deactivate")}>
                    Deactivate
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <Section
        title="Staff today"
        actions={
          canAssign ? (
            <>
              <Button onClick={() => setOpen("assign-senior")}>
                {today?.senior ? "Change Senior" : "Assign Senior"}
              </Button>
              <Button onClick={() => setOpen("assign-junior")}>
                Add Junior
              </Button>
            </>
          ) : null
        }
      >
        {staffing.status === "loading" ? (
          <Skeleton className="h-20 w-full" />
        ) : staffing.status === "error" ? (
          <LoadFailed message={staffing.message} onRetry={staffing.reload} />
        ) : !record.isActive ? (
          <p className="text-body text-ink-muted">
            This line is inactive, so no current staffing is shown. Its history
            is below.
          </p>
        ) : (
          <StatGrid columns={3}>
            <Stat label="Senior">
              {today?.senior ? (
                today.senior.name
              ) : (
                <Badge tone="warning">No Senior assigned</Badge>
              )}
            </Stat>
            <Stat label="Juniors">{today ? today.juniorCount : "—"}</Stat>
            <Stat label="Customers">{today ? today.customerCount : "—"}</Stat>
          </StatGrid>
        )}
      </Section>

      <Section title="Collections and money">
        <p className="text-body text-ink-muted">
          Account value, invested amount, profit, and expected and actual daily
          collection appear here once accounts and collections are recorded.
          Until then nothing is shown, rather than zeros.
        </p>
      </Section>

      <Section title="Assignment history">
        {history.status === "ready" && history.rows.length > 0 ? (
          <>
            <DataView
              caption="Assignment history"
              rows={history.rows}
              getRowId={(entry) => entry.id}
              complete={!history.hasMore}
              columns={[
                identityColumn<AssignmentHistoryEntry>({
                  header: "Staff",
                  name: (entry) => entry.staffName,
                  href: (entry) => `/team/${entry.staffProfileId}`,
                }),
                valueColumn<AssignmentHistoryEntry>({
                  id: "role",
                  header: "Role",
                  value: (entry) => ROLE_LABEL[entry.assignmentRole],
                }),
                valueColumn<AssignmentHistoryEntry>({
                  id: "from",
                  header: "From",
                  value: (entry) => entry.effectiveFrom,
                  cell: (entry) => formatBusinessDate(entry.effectiveFrom),
                }),
                valueColumn<AssignmentHistoryEntry>({
                  id: "to",
                  header: "To",
                  // An open assignment sorts after every closed one.
                  value: (entry) => entry.effectiveTo ?? "9999-12-31",
                  cell: (entry) =>
                    entry.effectiveTo ? (
                      formatBusinessDate(entry.effectiveTo)
                    ) : (
                      <Badge tone="info">Open</Badge>
                    ),
                }),
              ]}
              footer={
                <ListFooter
                  shown={history.rows.length}
                  noun={
                    history.rows.length === 1 ? "assignment" : "assignments"
                  }
                  onMore={history.loadMore}
                  loadingMore={history.loadingMore}
                  note={history.moreError ?? undefined}
                />
              }
            />
          </>
        ) : (
          <ListFallback
            query={history}
            columns={4}
            empty={
              <NothingYet
                title="No one has been assigned"
                description="When a Senior or Junior is assigned to this line, each assignment is kept here with its dates."
              />
            }
          />
        )}
      </Section>

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
