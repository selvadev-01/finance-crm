"use client";

import type { Line, LineStaffing, Sector } from "@repo/contracts";
import { Badge, type DataColumn, DataTable } from "@repo/ui";
import Link from "next/link";

import { StatusBadge } from "./status-badge";

/**
 * Lines with today's staffing (US-014). Staffing is only reported for active
 * lines, so an inactive line shows a dash rather than a zero it does not know.
 */
export function LineTable({
  lines,
  staffing,
  sectors,
}: {
  lines: Line[];
  /** `null` while staffing is loading or could not be read. */
  staffing: Map<string, LineStaffing> | null;
  /** Given when the sector column should show; omitted on a sector's page. */
  sectors?: Map<string, Sector>;
}) {
  const staffed = (line: Line) => staffing?.get(line.id);

  const columns: DataColumn<Line>[] = [
    {
      header: "Line",
      cell: (line) => (
        <Link
          href={`/lines/${line.id}`}
          className="flex flex-col font-medium text-ink hover:text-accent hover:underline"
        >
          {line.name}
          <span className="font-mono text-2xs font-normal text-ink-muted">
            {line.code}
          </span>
        </Link>
      ),
    },
    ...(sectors
      ? [
          {
            header: "Sector",
            cell: (line: Line) => sectors.get(line.sectorId)?.name ?? "—",
          },
        ]
      : []),
    {
      header: "Senior",
      cell: (line) => {
        const row = staffed(line);
        if (!row) return "—";
        return row.senior ? (
          row.senior.name
        ) : (
          <Badge tone="warning">No Senior</Badge>
        );
      },
    },
    {
      header: "Juniors",
      align: "end",
      cell: (line) => staffed(line)?.juniorCount ?? "—",
    },
    {
      header: "Customers",
      align: "end",
      cell: (line) => staffed(line)?.customerCount ?? "—",
    },
    {
      header: "Status",
      align: "end",
      cell: (line) => <StatusBadge isActive={line.isActive} />,
    },
  ];

  return (
    <DataTable
      caption="Lines"
      rows={lines}
      rowKey={(line) => line.id}
      columns={columns}
    />
  );
}

export function staffingByLine(rows: LineStaffing[]): Map<string, LineStaffing> {
  return new Map(rows.map((row) => [row.lineId, row]));
}
