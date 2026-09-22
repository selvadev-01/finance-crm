"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  CaretDown,
  SlidersHorizontal,
} from "@phosphor-icons/react/dist/ssr";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowData,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
  useState,
} from "react";

import { Button } from "./button";
import { cn } from "./cn";
import { flatSurfaceClass } from "./layout";
import { LoadMoreSentinel } from "./load-more";

declare module "@tanstack/react-table" {
  // Column options Rasi adds. The type parameters must match TanStack's own.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** `end` for amounts and counts, so they line up. */
    align?: "start" | "end";
    /** Left out of the card a row becomes below 768px. */
    hideOnCard?: boolean;
    /**
     * Where the cell sits on that card. `headline`: the row's key amount,
     * large, beside the identity. `status`: its badge, under the headline.
     * Anything else goes in the two-column grid below.
     */
    card?: "headline" | "status";
  }
}

export type DataViewColumn<Row> = ColumnDef<Row, unknown>;

export interface DataViewProps<Row> {
  /** Names the table for assistive technology; not shown. */
  caption: string;
  columns: DataViewColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /**
   * Whether every row is loaded. Sorting is offered only then: sorting a
   * truncated list would show "the largest of the first 200" as the largest.
   */
  complete: boolean;
  initialSort?: SortingState;
  /** A `ListFooter`, drawn as the bottom band of the table's frame. */
  footer?: ReactNode;
  /** `flat` on a dashboard, among flat cards (ADR-0015); `outlined` elsewhere. */
  frame?: "outlined" | "flat";
  className?: string;
}

/**
 * A list of records (ADR-0013): a table from 768px, a stack of cards below it
 * (navigation-ia.md#responsive-behaviour). TanStack Table is the model; this
 * is the only place its markup is written.
 *
 * The first column is the record's identity — it heads each card, and is where
 * a screen puts the link to the detail page; styled with `rowLinkClass` and
 * marked `data-row-link`, that link covers the whole row. Columns are TanStack column
 * definitions; `meta.align` and `meta.hideOnCard` are Rasi's additions, and
 * `enableSorting: false` turns sorting off for a column that has no order.
 *
 * No empty state here on purpose: a list must say which of the three empty
 * states it is in, and only the screen knows (`ListState`).
 */
export function DataView<Row>({
  caption,
  columns,
  rows,
  getRowId,
  complete,
  initialSort = [],
  footer,
  frame = "outlined",
  className,
}: DataViewProps<Row>) {
  const surface =
    frame === "flat"
      ? flatSurfaceClass
      : "rounded-surface border border-border bg-surface-raised shadow-raised";
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  // TanStack returns a mutable table object, so the React Compiler leaves this
  // component unmemoised. That is the documented trade-off, and fine for a list.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => getRowId(row),
    state: { sorting },
    onSortingChange: setSorting,
    enableSorting: complete,
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  // A row whose identity is a `rowLinkClass` link opens on a click anywhere;
  // any other control in it sits above that link's overlay.
  const linkedRow =
    "relative has-[[data-row-link]]:cursor-pointer [&_:is(a,button,input,select,textarea,label):not([data-row-link])]:relative [&_:is(a,button,input,select,textarea,label):not([data-row-link])]:z-10";
  const tableRows = table.getRowModel().rows;

  return (
    <div className={className}>
      <div className={cn("hidden overflow-x-auto md:block", surface)}>
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-sunken">
              {headers.map((header) => {
                const align = header.column.columnDef.meta?.align;
                const sorted = header.column.getIsSorted();
                const label = flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                );
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                    className={cn(
                      "h-9 px-[var(--cell-padding-x)] text-2xs font-medium tracking-wider whitespace-nowrap text-ink-subtle uppercase",
                      align === "end" ? "text-right" : "text-left",
                    )}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase hover:text-ink",
                          align === "end" && "flex-row-reverse",
                          sorted && "text-ink",
                        )}
                      >
                        {label}
                        {sorted === "asc" ? (
                          <ArrowUp aria-hidden size={12} weight="bold" />
                        ) : sorted === "desc" ? (
                          <ArrowDown aria-hidden size={12} weight="bold" />
                        ) : (
                          <ArrowsDownUp
                            aria-hidden
                            size={12}
                            className="opacity-50"
                          />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken/70",
                  linkedRow,
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "px-[var(--cell-padding-x)] py-[var(--row-padding-y)] align-middle text-ink",
                      cell.column.columnDef.meta?.align === "end"
                        ? "text-right tabular-nums"
                        : "text-left",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {footer ? (
          <div className="border-t border-border bg-surface-raised px-[var(--cell-padding-x)] py-2.5">
            {footer}
          </div>
        ) : null}
      </div>

      {/*
       * The phone card (docs/05-ux/stitch-mobile): the identity with the
       * headline amount and status beside it, then the other fields as small
       * label-over-value pairs, two to a row, so a screen holds several.
       */}
      <ul aria-label={caption} className="flex flex-col gap-2 md:hidden">
        {tableRows.map((row) => {
          const [identity, ...rest] = row.getVisibleCells();
          const shown = rest.filter(
            (cell) => !cell.column.columnDef.meta?.hideOnCard,
          );
          const headline = shown.filter(
            (cell) => cell.column.columnDef.meta?.card === "headline",
          );
          const status = shown.filter(
            (cell) => cell.column.columnDef.meta?.card === "status",
          );
          const details = shown.filter(
            (cell) => !cell.column.columnDef.meta?.card,
          );
          const aside = [...headline, ...status];
          return (
            <li
              key={row.id}
              className={cn("flex flex-col gap-3 p-3.5", surface, linkedRow)}
            >
              <div className="flex items-start justify-between gap-3">
                {identity ? (
                  <div className="min-w-0 text-body">
                    {flexRender(
                      identity.column.columnDef.cell,
                      identity.getContext(),
                    )}
                  </div>
                ) : null}
                {aside.length > 0 ? (
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {headline.map((cell) => (
                      <div
                        key={cell.id}
                        className="text-heading text-ink tabular-nums"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    ))}
                    {status.map((cell) => (
                      <div key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {details.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3">
                  {details.map((cell) => {
                    const header = cell.column.columnDef.header;
                    return (
                      <div
                        key={cell.id}
                        className="flex min-w-0 flex-col gap-0.5"
                      >
                        <dt className="text-caption text-ink-subtle">
                          {typeof header === "string" ? header : cell.column.id}
                        </dt>
                        <dd className="min-w-0 text-body break-words text-ink tabular-nums">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
      {footer ? <div className="pt-3 md:hidden">{footer}</div> : null}
    </div>
  );
}

/**
 * The controls above a list, in a light framed panel. Filters sit left and
 * wrap; `actions` (a clear-filters link, an export) sit right, level with the
 * controls.
 *
 * Below 768px the filters fold behind a "Filters" button, so the first
 * records are on the first screen of a phone (docs/05-ux/stitch-mobile).
 * `summary` says what they are set to while folded — "14 to 20 Sep, all
 * lines" — so nobody has to open them to know what the list shows.
 */
export function FilterBar({
  children,
  actions,
  summary,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-3 shadow-raised md:flex-row md:flex-wrap md:items-end">
      {children ? (
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((was) => !was)}
            className="flex min-h-[var(--control-height)] min-w-0 flex-1 items-center gap-2 rounded-control text-left text-label text-ink"
          >
            <SlidersHorizontal aria-hidden size={18} className="shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span>Filters</span>
              {summary ? (
                <span className="truncate text-caption text-ink-muted">
                  {summary}
                </span>
              ) : null}
            </span>
            <CaretDown
              aria-hidden
              size={14}
              className={cn(
                "ml-auto shrink-0 text-ink-subtle transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      ) : null}
      {children ? (
        <div
          id={panelId}
          className={cn(
            // From 768px the wrapper dissolves, so the filters sit in the
            // panel's own row beside the actions, as before.
            "flex-wrap items-end gap-x-3 gap-y-3 md:contents",
            open ? "flex" : "hidden",
          )}
        >
          {children}
        </div>
      ) : null}
      {actions ? (
        <div className="flex min-h-[var(--control-height)] flex-wrap items-center gap-2 md:ml-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

const filterWidth = {
  sm: "sm:w-40",
  md: "sm:w-56",
  lg: "sm:w-72",
} as const;

/**
 * One labelled filter. A `Field` without hint or error, sized for a toolbar:
 * full width on a phone, a fixed width beside its neighbours above that.
 */
export function FilterField({
  label,
  width = "md",
  children,
}: {
  label: string;
  width?: keyof typeof filterWidth;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-[var(--field-gap)]",
        filterWidth[width],
      )}
    >
      <FilterLabel label={label}>{children}</FilterLabel>
    </div>
  );
}

function FilterLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const control = Children.only(children);
  return (
    <>
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>
      {isValidElement<{ id?: string }>(control)
        ? cloneElement(control, { id })
        : control}
    </>
  );
}

/** An empty state inside the same frame a table has. */
export function EmptyFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-surface border border-border bg-surface-raised">
      {children}
    </div>
  );
}

/**
 * The loading state of a list: the same frame with placeholder bars, so the
 * page does not jump when the rows arrive. Not a spinner.
 */
export function ListSkeleton({
  columns = 4,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  const cells = Array.from({ length: columns }, (_, index) => index);
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-surface border border-border bg-surface-raised"
    >
      <div className="h-9 border-b border-border bg-surface-sunken" />
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex gap-6 border-b border-border px-[var(--cell-padding-x)] py-[var(--row-padding-y)] last:border-b-0"
        >
          {cells.map((cell) => (
            <div
              key={cell}
              className={cn(
                "h-4 flex-1 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none",
                cell > 1 && "hidden md:block",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The foot of a list: how many are shown, and the next cursor page
 * (api-design.md#pagination). `onMore` is absent when everything is loaded.
 *
 * The next page loads by itself as the reader scrolls near the end (a lazy
 * list in the one page scroll, never a scroll box of its own); "Show more"
 * stays for the keyboard, and for a browser without IntersectionObserver.
 */
export function ListFooter({
  shown,
  noun,
  onMore,
  loadingMore,
  note,
}: {
  shown: number;
  noun: string;
  onMore?: () => void;
  loadingMore?: boolean;
  /** Replaces the count sentence — "Showing the first 200 lines. Filter to see the rest." */
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {onMore ? (
        <LoadMoreSentinel onMore={onMore} busy={loadingMore === true} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-muted">
        <span data-numeric>{note ?? `${shown} ${noun}`}</span>
        {onMore ? (
          <Button size="sm" onClick={onMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
