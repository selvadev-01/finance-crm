"use client";

import type { Line, LineStaffing, Sector } from "@repo/contracts";
import { Badge, CodeChip, DataView, type DataViewColumn } from "@repo/ui";
import type { ReactNode } from "react";

import {
  displayColumn,
  identityColumn,
  valueColumn,
} from "../../../components/columns";
import { ActivityBadge } from "../../../components/status-badge";

/**
 * Lines with today's staffing (US-014). Staffing is only reported for active
 * lines, so an inactive line shows a dash rather than a zero it does not know.
 */
export function LineTable({
  lines,
  staffing,
  sectors,
  complete,
  footer,
}: {
  lines: Line[];
  /** `null` while staffing is loading or could not be read. */
  staffing: Map<string, LineStaffing> | null;
  /** Given when the sector column should show; omitted on a sector's page. */
  sectors?: Map<string, Sector>;
  /** Whether every line is loaded, so sorting is honest. */
  complete: boolean;
  /** A `ListFooter`, drawn inside the table's frame. */
  footer?: ReactNode;
}) {
  const staffed = (line: Line) => staffing?.get(line.id);

  const columns: DataViewColumn<Line>[] = [
    identityColumn<Line>({
      header: "Line",
      name: (line) => line.name,
      code: (line) => line.code,
      href: (line) => `/lines/${line.id}`,
    }),
    ...(sectors
      ? [
          valueColumn<Line>({
            id: "sector",
            header: "Sector",
            value: (line) => sectors.get(line.sectorId)?.name ?? "—",
            cell: (line) => {
              const sector = sectors.get(line.sectorId);
              if (!sector) return "—";
              return (
                <span className="inline-flex items-center gap-2">
                  <CodeChip>{sector.code}</CodeChip>
                  {sector.name}
                </span>
              );
            },
          }),
        ]
      : []),
    valueColumn<Line>({
      id: "senior",
      header: "Senior",
      value: (line) => staffed(line)?.senior?.name ?? "",
      cell: (line) => {
        const row = staffed(line);
        if (!row) return "—";
        return row.senior ? (
          row.senior.name
        ) : (
          <Badge tone="warning">No Senior</Badge>
        );
      },
    }),
    valueColumn<Line>({
      id: "juniors",
      header: "Juniors",
      align: "end",
      value: (line) => staffed(line)?.juniorCount ?? -1,
      cell: (line) => staffed(line)?.juniorCount ?? "—",
    }),
    valueColumn<Line>({
      id: "customers",
      header: "Customers",
      align: "end",
      value: (line) => staffed(line)?.customerCount ?? -1,
      cell: (line) => staffed(line)?.customerCount ?? "—",
    }),
    displayColumn<Line>({
      id: "status",
      header: "Status",
      align: "end",
      cell: (line) => <ActivityBadge isActive={line.isActive} />,
    }),
  ];

  return (
    <DataView
      caption="Lines"
      rows={lines}
      getRowId={(line) => line.id}
      columns={columns}
      complete={complete}
      footer={footer}
    />
  );
}

export function staffingByLine(
  rows: LineStaffing[],
): Map<string, LineStaffing> {
  return new Map(rows.map((row) => [row.lineId, row]));
}
