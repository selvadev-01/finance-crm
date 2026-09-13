"use client";

import { organisationContract as org, staffContract } from "@repo/contracts";
import {
  Badge,
  Button,
  DataTable,
  DataTableSkeleton,
  formatBusinessDate,
  NothingYet,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import {
  canManageOrganisation,
  canResetPasswordOf,
  ROLE_LABEL,
  worksLines,
} from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { AssignDialog } from "../../_organisation/assign-dialog";
import {
  LIST_LIMIT,
  LoadFailed,
  RecordNotFound,
  Surface,
} from "../../_organisation/list-controls";
import { StaffStatusBadge } from "../../_organisation/staff-status-badge";
import { ResetPasswordDialog } from "./reset-password-dialog";

type Open = "assign" | "reset" | null;

export function StaffDetailView({ staffProfileId }: { staffProfileId: string }) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [open, setOpen] = useState<Open>(null);

  const person = useApiQuery(staffContract.getStaff, {
    params: { staffProfileId },
  });
  // Lines to choose from when assigning; only an Admin assigns.
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT, includeInactive: "true" } } : null,
  );

  if (person.status === "loading") {
    return <DataTableSkeleton columns={4} rows={3} />;
  }
  if (person.status === "not-found" || person.status === "not-permitted") {
    return <RecordNotFound noun="Staff member" />;
  }
  if (person.status === "error") {
    return <LoadFailed message={person.message} onRetry={person.reload} />;
  }

  const record = person.data;
  const allLines = lines.status === "ready" ? lines.data.data : [];
  const lineNames = new Map(allLines.map((line) => [line.id, line.name]));
  const role = record.role;
  const assignable =
    manages && worksLines(role) && record.status === "ACTIVE";
  const current = record.currentAssignment;
  const lineLink = (lineId: string, name: string) => (
    <Link href={`/lines/${lineId}`} className="text-ink hover:text-accent hover:underline">
      {name}
    </Link>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/team" className="hover:text-ink hover:underline">
            Team
          </Link>
        }
        title={record.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {ROLE_LABEL[role]}
            <span aria-hidden>·</span>
            <span className="font-mono">{record.staffCode}</span>
            <StaffStatusBadge status={record.status} />
          </span>
        }
        actions={
          <>
            {assignable ? (
              <Button
                tone="primary"
                onClick={() => setOpen("assign")}
                disabled={lines.status !== "ready"}
              >
                Assign to a line
              </Button>
            ) : null}
            {canResetPasswordOf(me, record) ? (
              <Button onClick={() => setOpen("reset")}>Reset password</Button>
            ) : null}
          </>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Line today">
          {current ? (
            lineLink(current.lineId, current.lineName)
          ) : worksLines(role) ? (
            <Badge tone="warning">No line today</Badge>
          ) : (
            "—"
          )}
        </Detail>
        <Detail label="Joined">{formatBusinessDate(record.joinedAt)}</Detail>
        <Detail label="Phone">
          <a href={`tel:${record.phone}`} className="hover:text-accent hover:underline">
            {record.phone}
          </a>
        </Detail>
        <Detail label="Email">
          <span className="break-all">{record.email}</span>
        </Detail>
      </dl>

      {worksLines(role) ? (
        <section aria-labelledby="staff-history" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="staff-history" className="text-base font-semibold text-ink">
              Assignment history
            </h2>
            {!manages ? (
              <p className="text-sm text-ink-muted">
                Only assignments on your line are shown.
              </p>
            ) : null}
          </div>
          {record.assignments.length === 0 ? (
            <Surface>
              <NothingYet
                title="Never assigned"
                description={
                  assignable
                    ? "Assign them to a line so they can start work."
                    : "No line assignments are recorded for this person."
                }
                action={
                  assignable && lines.status === "ready" ? (
                    <Button tone="primary" onClick={() => setOpen("assign")}>
                      Assign to a line
                    </Button>
                  ) : undefined
                }
              />
            </Surface>
          ) : (
            <DataTable
              caption="Assignment history"
              rows={record.assignments}
              rowKey={(entry) => entry.assignmentId}
              columns={[
                {
                  header: "Line",
                  cell: (entry) => lineLink(entry.lineId, entry.lineName),
                },
                {
                  header: "As",
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
                    entry.upcoming ? (
                      <Badge tone="info">Starts later</Badge>
                    ) : entry.effectiveTo ? (
                      formatBusinessDate(entry.effectiveTo)
                    ) : (
                      <Badge tone="info">Open</Badge>
                    ),
                },
              ]}
            />
          )}
        </section>
      ) : null}

      {open === "assign" && worksLines(role) ? (
        <AssignDialog
          target={{ from: "staff", staff: { ...record, role }, lines: allLines }}
          lineNames={lineNames}
          onClose={() => setOpen(null)}
          onAssigned={() => {
            setOpen(null);
            person.reload();
          }}
        />
      ) : null}
      {open === "reset" ? (
        <ResetPasswordDialog
          staffProfileId={record.staffProfileId}
          name={record.name}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
