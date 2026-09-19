import { type DataViewColumn, RecordIdentity, rowLinkClass } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { compareMoney } from "../lib/money";
import { Money } from "./money";

/**
 * Column builders for `DataView`, so every list sorts money the same exact
 * way and every identity cell looks the same.
 */

/**
 * The first column: the record's name linked to its page, with its code
 * under it. The link covers the whole row. It sorts by name.
 */
export function identityColumn<Row>(options: {
  header: string;
  name: (row: Row) => string;
  code?: (row: Row) => ReactNode;
  href?: (row: Row) => string | null;
}): DataViewColumn<Row> {
  return {
    id: "identity",
    header: options.header,
    accessorFn: (row) => options.name(row),
    cell: ({ row }) => {
      const href = options.href?.(row.original) ?? null;
      const name = options.name(row.original);
      return (
        <RecordIdentity code={options.code?.(row.original)}>
          {href ? (
            <Link href={href} className={rowLinkClass} data-row-link>
              {name}
            </Link>
          ) : (
            name
          )}
        </RecordIdentity>
      );
    },
  };
}

/**
 * An amount column: right-aligned, tabular, and sorted in exact paise — as
 * text "1200.00" would sort before "250.00" (BR-11).
 */
export function moneyColumn<Row>(options: {
  id: string;
  header: string;
  amount: (row: Row) => string;
  /** How to show it, when a plain amount is not enough (a signed change). */
  render?: (row: Row) => ReactNode;
}): DataViewColumn<Row> {
  return {
    id: options.id,
    header: options.header,
    accessorFn: (row) => options.amount(row),
    sortingFn: (a, b) =>
      compareMoney(options.amount(a.original), options.amount(b.original)),
    cell: ({ row }) =>
      options.render?.(row.original) ?? (
        <Money amount={options.amount(row.original)} />
      ),
    meta: { align: "end" },
  };
}

/** A column that shows something with no useful order: a badge, an action. */
export function displayColumn<Row>(options: {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "start" | "end";
  /** Left out of the phone card. */
  hideOnCard?: boolean;
}): DataViewColumn<Row> {
  return {
    id: options.id,
    header: options.header,
    enableSorting: false,
    cell: ({ row }) => options.cell(row.original),
    meta: { align: options.align, hideOnCard: options.hideOnCard },
  };
}

/** A plain text or number column, sorted by the value it shows. */
export function valueColumn<Row>(options: {
  id: string;
  header: string;
  value: (row: Row) => string | number;
  cell?: (row: Row) => ReactNode;
  align?: "start" | "end";
}): DataViewColumn<Row> {
  return {
    id: options.id,
    header: options.header,
    accessorFn: options.value,
    cell: ({ row }) =>
      options.cell?.(row.original) ?? options.value(row.original),
    meta: { align: options.align },
  };
}
