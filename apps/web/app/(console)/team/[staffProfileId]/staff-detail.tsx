"use client";

import {
  organisationContract as org,
  type StaffDetail,
  staffContract,
} from "@repo/contracts";
import {
  Badge,
  Button,
  DataView,
  Description,
  DescriptionList,
  EmptyFrame,
  formatBusinessDate,
  NothingYet,
  PageHeader,
  recordLinkClass,
  Section,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { identityColumn, valueColumn } from "../../../../components/columns";
import { PageTrail } from "../../../../components/page-trail";
import { RecordFallback } from "../../../../components/query-state";
import { StatusBadge } from "../../../../components/status-badge";
import { formatMobile } from "../../../../lib/format";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import {
  canChangeRoleOf,
  canDeleteStaff,
  canChangeStatusOf,
  canEditStaff,
  canManageOrganisation,
  canResetPasswordOf,
  ROLE_LABEL,
  worksLines,
} from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { AssignDialog } from "../../_organisation/assign-dialog";
import {
  ChangeRoleDialog,
  ChangeStatusDialog,
  DeleteStaffDialog,
  EditStaffDialog,
} from "../staff-dialogs";
import { ResetPasswordDialog } from "./reset-password-dialog";

type Open =
  | "assign"
  | "reset"
  | "edit"
  | "role"
  | "suspend"
  | "deactivate"
  | "reactivate"
  | "delete"
  | null;
type AssignmentRow = StaffDetail["assignments"][number];

/** A staff member: today's line, contact details and assignment history (US-014, US-015). */
export function StaffDetailView({
  staffProfileId,
}: {
  staffProfileId: string;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);

  const person = useApiQuery(staffContract.getStaff, {
    params: { staffProfileId },
  });
  // Lines to choose from when assigning; only an Admin assigns.
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT, includeInactive: "true" } } : null,
  );

  if (person.status !== "ready")
    return <RecordFallback query={person} noun="Staff member" />;

  const record = person.data;
  const allLines = lines.status === "ready" ? lines.data.data : [];
  const lineNames = new Map(allLines.map((line) => [line.id, line.name]));
  const role = record.role;
  const assignable = manages && worksLines(role) && record.status === "ACTIVE";
  const current = record.currentAssignment;
  const assignButton = (
    <Button
      tone="primary"
      onClick={() => setOpen("assign")}
      disabled={lines.status !== "ready"}
    >
      Assign to a line
    </Button>
  );

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[{ label: "Team", href: "/team" }, { label: record.name }]}
          />
        }
        title={record.name}
        meta={
          <>
            {ROLE_LABEL[role]}
            <span aria-hidden>·</span>
            <span className="font-mono">{record.staffCode}</span>
            <StatusBadge kind="staff" value={record.status} />
          </>
        }
        actions={
          <>
            {assignable ? assignButton : null}
            {canEditStaff(me, record) ? (
              <Button onClick={() => setOpen("edit")}>Edit details</Button>
            ) : null}
            {canChangeRoleOf(me, record) ? (
              <Button onClick={() => setOpen("role")}>Change role</Button>
            ) : null}
            {canResetPasswordOf(me, record) ? (
              <Button onClick={() => setOpen("reset")}>Reset password</Button>
            ) : null}
            {/* Last: the destructive action never sits where Enter finds it. */}
            {canChangeStatusOf(me, record) ? (
              <>
                {record.status !== "ACTIVE" ? (
                  <Button onClick={() => setOpen("reactivate")}>
                    Reactivate
                  </Button>
                ) : null}
                {/* Suspension is temporary; "left the business" is not, and
                    M01 keeps them apart. Neither deletes anything. */}
                {record.status === "ACTIVE" ? (
                  <Button tone="danger" onClick={() => setOpen("suspend")}>
                    Suspend
                  </Button>
                ) : null}
                {record.status !== "INACTIVE" ? (
                  <Button tone="danger" onClick={() => setOpen("deactivate")}>
                    Mark as left
                  </Button>
                ) : null}
                {/* US-092: removal is Admin and above (decided 2026-09-20,
                    never on anyone senior) and cannot be undone, so it sits
                    last and never where Enter finds it. */}
                {canDeleteStaff(me, record) ? (
                  <Button tone="danger" onClick={() => setOpen("delete")}>
                    Delete
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <DescriptionList layout="columns">
        <Description term="Line today">
          {current ? (
            <Link href={`/lines/${current.lineId}`} className={recordLinkClass}>
              {current.lineName}
            </Link>
          ) : worksLines(role) ? (
            <Badge tone="warning">No line today</Badge>
          ) : null}
        </Description>
        <Description term="Joined">
          {formatBusinessDate(record.joinedAt)}
        </Description>
        <Description term="Phone">
          <a href={`tel:${record.phone}`} className={recordLinkClass}>
            {formatMobile(record.phone)}
          </a>
        </Description>
        <Description term="Email">
          <span className="break-all">{record.email}</span>
        </Description>
      </DescriptionList>

      {worksLines(role) ? (
        <Section
          title="Assignment history"
          description={
            manages ? undefined : "Only assignments on your line are shown."
          }
        >
          {record.assignments.length === 0 ? (
            <EmptyFrame>
              <NothingYet
                title="Never assigned"
                description={
                  assignable
                    ? "Assign them to a line so they can start work."
                    : "No line assignments are recorded for this person."
                }
                action={
                  assignable && lines.status === "ready"
                    ? assignButton
                    : undefined
                }
              />
            </EmptyFrame>
          ) : (
            <DataView
              caption="Assignment history"
              rows={record.assignments}
              getRowId={(entry) => entry.assignmentId}
              complete
              columns={[
                identityColumn<AssignmentRow>({
                  header: "Line",
                  name: (entry) => entry.lineName,
                  code: (entry) => entry.lineCode,
                  href: (entry) => `/lines/${entry.lineId}`,
                }),
                valueColumn<AssignmentRow>({
                  id: "as",
                  header: "As",
                  value: (entry) => ROLE_LABEL[entry.assignmentRole],
                }),
                valueColumn<AssignmentRow>({
                  id: "from",
                  header: "From",
                  value: (entry) => entry.effectiveFrom,
                  cell: (entry) => formatBusinessDate(entry.effectiveFrom),
                }),
                valueColumn<AssignmentRow>({
                  id: "to",
                  header: "To",
                  // Open and upcoming assignments sort after every closed one.
                  value: (entry) =>
                    entry.upcoming || !entry.effectiveTo
                      ? "9999-12-31"
                      : entry.effectiveTo,
                  cell: (entry) =>
                    entry.upcoming ? (
                      <Badge tone="info">Starts later</Badge>
                    ) : entry.effectiveTo ? (
                      formatBusinessDate(entry.effectiveTo)
                    ) : (
                      <Badge tone="info">Open</Badge>
                    ),
                }),
              ]}
            />
          )}
        </Section>
      ) : null}

      {open === "assign" && worksLines(role) ? (
        <AssignDialog
          target={{
            from: "staff",
            staff: { ...record, role },
            lines: allLines,
          }}
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
      {open === "edit" ? (
        <EditStaffDialog
          staff={record}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            person.reload();
          }}
        />
      ) : null}
      {open === "role" ? (
        <ChangeRoleDialog
          staff={record}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            person.reload();
          }}
        />
      ) : null}
      {open === "delete" ? (
        <DeleteStaffDialog
          staff={record}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            router.replace("/team");
          }}
        />
      ) : null}

      {open === "suspend" || open === "deactivate" || open === "reactivate" ? (
        <ChangeStatusDialog
          staff={record}
          status={
            open === "suspend"
              ? "SUSPENDED"
              : open === "deactivate"
                ? "INACTIVE"
                : "ACTIVE"
          }
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            person.reload();
          }}
        />
      ) : null}
    </>
  );
}
