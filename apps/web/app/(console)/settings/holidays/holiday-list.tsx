"use client";

import {
  type Holiday,
  holidayContract,
  organisationContract as org,
} from "@repo/contracts";
import { dayOfWeek, parseCalendarDate } from "@repo/domain";
import {
  Badge,
  Button,
  DataView,
  FilterBar,
  FilterField,
  FormMessage,
  formatBusinessDate,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import { useState } from "react";

import { displayColumn, valueColumn } from "../../../../components/columns";
import { ListFallback } from "../../../../components/list-state";
import { Pager } from "../../../../components/pager";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { AddHolidayDialog, RemoveHolidayDialog } from "./holiday-dialogs";

export const HOLIDAY_FILTERS = { period: "upcoming" };

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const weekday = (date: string) =>
  WEEKDAYS[dayOfWeek(parseCalendarDate(date))] ?? "";

/**
 * S-27 · Holidays (US-093): the days no collection is due, beside Sundays.
 * Admins declare future holidays, business-wide or for one sector, and remove
 * future ones; a declared day moves the pending collections it covers. Past
 * holidays are history and offer no action.
 */
export function HolidayList({
  initial,
}: {
  initial: Partial<typeof HOLIDAY_FILTERS>;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const { filters, setFilter } = useListState(HOLIDAY_FILTERS, initial);
  const period = filters.period === "past" ? "past" : "upcoming";

  const holidays = usePagedQuery(
    holidayContract.listHolidays,
    { query: { period } },
    { url: true },
  );
  // Active sectors, for "Applies to" in the dialog.
  const sectors = useApiQuery(
    org.listSectors,
    manages ? { query: { limit: LIST_LIMIT } } : null,
  );

  const addHoliday = manages ? (
    <Button tone="primary" onClick={() => setAdding(true)}>
      Add holiday
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Holidays"
        description="No collections are due on these days. Schedules skip them, like Sundays."
        actions={addHoliday}
      />

      <FormMessage tone="info">
        Declaring a holiday moves every pending collection on and after that day
        to the next working day, for the accounts it covers. Removing one moves
        them back. Collected days never change, and staff on the lines it covers
        are told.
      </FormMessage>

      <FilterBar summary={period === "past" ? "Past" : "Upcoming"}>
        <FilterField label="Show" width="sm">
          <Select
            value={period}
            onChange={(event) => setFilter("period", event.target.value)}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </Select>
        </FilterField>
      </FilterBar>

      {holidays.status === "ready" && holidays.rows.length > 0 ? (
        <DataView
          caption={period === "past" ? "Past holidays" : "Upcoming holidays"}
          rows={holidays.rows}
          getRowId={(holiday) => holiday.id}
          complete={holidays.pageCount <= 1}
          columns={[
            valueColumn<Holiday>({
              id: "date",
              header: "Date",
              value: (holiday) => holiday.date,
              cell: (holiday) => (
                <span data-numeric>{formatBusinessDate(holiday.date)}</span>
              ),
            }),
            valueColumn<Holiday>({
              id: "day",
              header: "Day",
              value: (holiday) => dayOfWeek(parseCalendarDate(holiday.date)),
              cell: (holiday) => weekday(holiday.date),
            }),
            valueColumn<Holiday>({
              id: "name",
              header: "Name",
              value: (holiday) => holiday.name,
              cell: (holiday) => (
                <span className="font-medium text-ink">{holiday.name}</span>
              ),
            }),
            displayColumn<Holiday>({
              id: "scope",
              header: "Applies to",
              card: "status",
              cell: (holiday) =>
                holiday.sector ? (
                  <Badge tone="neutral">{holiday.sector.name}</Badge>
                ) : (
                  <Badge tone="info">All sectors</Badge>
                ),
            }),
            valueColumn<Holiday>({
              id: "addedBy",
              header: "Added by",
              value: (holiday) => holiday.addedBy?.name ?? "",
              cell: (holiday) => holiday.addedBy?.name ?? "—",
            }),
            ...(manages
              ? [
                  displayColumn<Holiday>({
                    id: "actions",
                    header: "Actions",
                    align: "end",
                    cell: (holiday) =>
                      holiday.removable ? (
                        <Button
                          tone="ghost"
                          size="sm"
                          onClick={() => setRemoving(holiday)}
                        >
                          Remove
                        </Button>
                      ) : null,
                  }),
                ]
              : []),
          ]}
          footer={
            <Pager list={holidays} noun="holidays" nounSingular="holiday" />
          }
        />
      ) : (
        <ListFallback
          query={holidays}
          columns={5}
          empty={
            period === "past" ? (
              <NothingYet
                title="No past holidays"
                description="Holidays appear here once their day has gone."
              />
            ) : (
              <NothingYet
                title="No upcoming holidays"
                description={
                  manages
                    ? "Add festival days and closures so nobody is expected to collect on them."
                    : "An Admin adds festival days and closures here."
                }
                action={addHoliday}
              />
            )
          }
        />
      )}

      <p className="text-label text-ink-muted">
        Past holidays, and today’s, stay in history and cannot be changed.
      </p>

      {adding ? (
        <AddHolidayDialog
          sectors={
            sectors.status === "ready"
              ? sectors.data.data.filter((sector) => sector.isActive)
              : []
          }
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            if (period === "upcoming") holidays.reload();
            else setFilter("period", "upcoming");
          }}
        />
      ) : null}
      {removing ? (
        <RemoveHolidayDialog
          holiday={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            holidays.reload();
          }}
        />
      ) : null}
    </>
  );
}
