import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * A list of records: a table from 768px, a stack of cards below it
 * (navigation-ia.md#responsive-behaviour).
 *
 * The first column is the record's identity — it heads each card, and is where
 * a screen puts the link to the detail page. The rest become label and value
 * pairs. Numbers set `align: "end"` so they line up down the column; the table
 * already uses tabular figures.
 *
 * No empty state here on purpose: a list must say which of the three empty
 * states it is in (`NothingYet`, `NoMatches`, `NotPermitted`), and only the
 * screen knows.
 */
export interface DataColumn<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "start" | "end";
}

export interface DataTableProps<Row> {
  /** Names the table for assistive technology; not shown. */
  caption: string;
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
}: DataTableProps<Row>) {
  const [identity, ...rest] = columns;

  return (
    <>
      <div className="hidden overflow-x-auto rounded-[var(--radius-surface)] border border-border bg-surface-raised md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-sunken">
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={cn(
                    "px-[var(--control-padding-x)] py-2 text-2xs font-medium tracking-wide text-ink-muted uppercase",
                    column.align === "end" ? "text-right" : "text-left",
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border last:border-b-0 hover:bg-surface-sunken/60"
              >
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cn(
                      "px-[var(--control-padding-x)] py-[var(--row-padding-y)] text-ink",
                      column.align === "end" ? "text-right" : "text-left",
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4"
          >
            {identity ? (
              <div className="text-sm font-medium text-ink">
                {identity.cell(row)}
              </div>
            ) : null}
            {rest.length > 0 ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {rest.map((column) => (
                  <div key={column.header} className="contents">
                    <dt className="text-ink-muted">{column.header}</dt>
                    <dd className="text-right text-ink" data-numeric>
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The loading state of a `DataTable`: the same frame with placeholder bars, so
 * the page does not jump when the rows arrive. Not a spinner.
 */
export function DataTableSkeleton({
  columns,
  rows = 5,
}: {
  columns: number;
  rows?: number;
}) {
  const cells = Array.from({ length: columns }, (_, index) => index);
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-[var(--radius-surface)] border border-border bg-surface-raised"
    >
      <div className="h-8 border-b border-border bg-surface-sunken" />
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex gap-6 border-b border-border px-[var(--control-padding-x)] py-[var(--row-padding-y)] last:border-b-0"
        >
          {cells.map((cell) => (
            <div
              key={cell}
              className={cn(
                "h-4 flex-1 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none",
                cell > 1 && "hidden md:block",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
