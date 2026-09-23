"use client";

import { type StaffSummary, staffContract } from "@repo/contracts";
import {
  Button,
  CodeChip,
  DataView,
  FilterBar,
  FilterField,
  formatBusinessDate,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import { useState } from "react";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../components/columns";
import { ListFallback } from "../../../components/list-state";
import { Pager } from "../../../components/pager";
import { STATUS, StatusBadge } from "../../../components/status-badge";
import {
  canCreateStaff,
  canManageOrganisation,
  ROLE_LABEL,
} from "../../../lib/roles";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";
import { AddStaffDialog } from "./staff-dialogs";

export const TEAM_FILTERS = { role: "", status: "" };

type StaffRole = StaffSummary["role"];
type StaffStatus = StaffSummary["status"];

const ROLES = Object.keys(ROLE_LABEL) as StaffRole[];
const STATUSES = Object.keys(STATUS.staff) as StaffStatus[];

/** S-14 · Team (US-014): everyone, and the line each works today. */
export function TeamList({
  initial,
}: {
  initial: Partial<typeof TEAM_FILTERS>;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const creates = canCreateStaff(me.role);
  const [adding, setAdding] = useState(false);
  const { filters, setFilter, reset, filtered } = useListState(
    TEAM_FILTERS,
    initial,
  );
  // A value from the URL the API would refuse is treated as no filter.
  const role = ROLES.find((each) => each === filters.role);
  const status = STATUSES.find((each) => each === filters.status);

  const staff = usePagedQuery(
    staffContract.listStaff,
    {
      query: {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
      },
    },
    { url: true },
  );

  return (
    <>
      <PageHeader
        title={manages ? "Team" : "Your line’s team"}
        description={
          manages
            ? "Everyone who works for the business, and the line each works today."
            : "The staff working your line today."
        }
        actions={
          creates ? (
            <Button tone="primary" onClick={() => setAdding(true)}>
              Add staff
            </Button>
          ) : null
        }
      />

      <FilterBar
        summary={`${role ? ROLE_LABEL[role] : "All roles"}, ${
          status ? STATUS.staff[status].label.toLowerCase() : "any status"
        }`}
      >
        <FilterField label="Role" width="sm">
          <Select
            value={role ?? ""}
            onChange={(event) => setFilter("role", event.target.value)}
          >
            <option value="">All roles</option>
            {ROLES.map((key) => (
              <option key={key} value={key}>
                {ROLE_LABEL[key]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status" width="sm">
          <Select
            value={status ?? ""}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="">Any status</option>
            {STATUSES.map((key) => (
              <option key={key} value={key}>
                {STATUS.staff[key].label}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {staff.status === "ready" && staff.rows.length > 0 ? (
        <>
          <DataView
            caption="Team"
            rows={staff.rows}
            getRowId={(person) => person.staffProfileId}
            complete={staff.pageCount <= 1}
            columns={[
              identityColumn<StaffSummary>({
                header: "Name",
                name: (person) => person.name,
                code: (person) => person.staffCode,
                href: (person) => `/team/${person.staffProfileId}`,
              }),
              valueColumn<StaffSummary>({
                id: "role",
                header: "Role",
                value: (person) => ROLE_LABEL[person.role],
              }),
              valueColumn<StaffSummary>({
                id: "line",
                header: "Line today",
                value: (person) => person.currentAssignment?.lineName ?? "—",
                cell: (person) => {
                  const assignment = person.currentAssignment;
                  if (!assignment) return "—";
                  return (
                    <span className="inline-flex items-center gap-2">
                      <CodeChip>{assignment.lineCode}</CodeChip>
                      {assignment.lineName}
                    </span>
                  );
                },
              }),
              valueColumn<StaffSummary>({
                id: "joined",
                header: "Joined",
                value: (person) => person.joinedAt,
                cell: (person) => formatBusinessDate(person.joinedAt),
              }),
              displayColumn<StaffSummary>({
                id: "status",
                header: "Status",
                align: "end",
                card: "status",
                cell: (person) => (
                  <StatusBadge kind="staff" value={person.status} />
                ),
              }),
            ]}
            footer={<Pager list={staff} noun="people" nounSingular="person" />}
          />
        </>
      ) : (
        <ListFallback
          query={staff}
          columns={5}
          empty={
            filtered ? (
              <NoMatches
                title="No one matches"
                description="No staff have this role and status. Clear the filters to see everyone."
                action={
                  <Button tone="link" onClick={reset}>
                    Clear filters
                  </Button>
                }
              />
            ) : manages ? (
              <NothingYet
                title="No staff yet"
                description="Everyone who works for the business is added here. They sign in with a temporary password you pass on."
                action={
                  creates ? (
                    <Button tone="primary" onClick={() => setAdding(true)}>
                      Add staff
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <NothingYet
                title="No one on your line today"
                description="You are not assigned to a line today, so there is no team to show."
              />
            )
          }
        />
      )}

      {adding ? (
        <AddStaffDialog
          myRole={me.role}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            staff.reload();
          }}
        />
      ) : null}
    </>
  );
}
