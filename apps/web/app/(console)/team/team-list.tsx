"use client";

import { type StaffSummary, staffContract } from "@repo/contracts";
import {
  Button,
  DataTable,
  DataTableSkeleton,
  formatBusinessDate,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { canManageOrganisation, ROLE_LABEL } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import {
  LIST_LIMIT,
  LoadFailed,
  Surface,
  TruncatedNote,
} from "../_organisation/list-controls";
import { StaffStatusBadge } from "../_organisation/staff-status-badge";

type RoleFilter = "" | StaffSummary["role"];
type StatusFilter = "" | StaffSummary["status"];

export function TeamList() {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [role, setRole] = useState<RoleFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");

  const staff = useApiQuery(staffContract.listStaff, {
    query: {
      limit: LIST_LIMIT,
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
    },
  });
  const filtered = role !== "" || status !== "";

  return (
    <>
      <PageHeader
        title={manages ? "Team" : "Your line’s team"}
        description={
          manages
            ? "Everyone who works for the business, and the line each works today."
            : "The staff working your line today."
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-48">
          Role
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as RoleFilter)}
          >
            <option value="">All roles</option>
            {(Object.keys(ROLE_LABEL) as StaffSummary["role"][]).map((key) => (
              <option key={key} value={key}>
                {ROLE_LABEL[key]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-48">
          Status
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </label>
      </div>

      {staff.status === "loading" ? <DataTableSkeleton columns={5} /> : null}
      {staff.status === "error" ? (
        <LoadFailed message={staff.message} onRetry={staff.reload} />
      ) : null}

      {staff.status === "ready" && staff.data.data.length === 0 ? (
        <Surface>
          {filtered ? (
            <NoMatches
              title="No one matches"
              description="No staff have this role and status. Clear the filters to see everyone."
              action={
                <Button
                  onClick={() => {
                    setRole("");
                    setStatus("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : manages ? (
            <NothingYet
              title="No staff yet"
              description="Staff accounts are created by an administrator. Adding staff from this screen arrives with staff management."
            />
          ) : (
            <NothingYet
              title="No one on your line today"
              description="You are not assigned to a line today, so there is no team to show."
            />
          )}
        </Surface>
      ) : null}

      {staff.status === "ready" && staff.data.data.length > 0 ? (
        <>
          <DataTable
            caption="Team"
            rows={staff.data.data}
            rowKey={(person) => person.staffProfileId}
            columns={[
              {
                header: "Name",
                cell: (person) => (
                  <Link
                    href={`/team/${person.staffProfileId}`}
                    className="flex flex-col font-medium text-ink hover:text-accent hover:underline"
                  >
                    {person.name}
                    <span className="font-mono text-2xs font-normal text-ink-muted">
                      {person.staffCode}
                    </span>
                  </Link>
                ),
              },
              { header: "Role", cell: (person) => ROLE_LABEL[person.role] },
              {
                header: "Line today",
                cell: (person) => person.currentAssignment?.lineName ?? "—",
              },
              {
                header: "Joined",
                cell: (person) => formatBusinessDate(person.joinedAt),
              },
              {
                header: "Status",
                align: "end",
                cell: (person) => <StaffStatusBadge status={person.status} />,
              },
            ]}
          />
          {staff.data.hasMore ? <TruncatedNote noun="staff" /> : null}
        </>
      ) : null}
    </>
  );
}
