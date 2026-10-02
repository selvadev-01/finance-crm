import { cn, formatCurrency } from "@repo/ui";
import type { ReactNode } from "react";

export interface EntryLine {
  /** The account, as the screen names it. */
  particulars: ReactNode;
  direction: "DEBIT" | "CREDIT";
  /** A decimal string, never a number. */
  amount: string;
}

/**
 * The lines of one double-entry posting in Debit and Credit columns — a
 * journal voucher (ADR-0018) or a ledger transaction (S-30). Each amount sits
 * in its own side's column and the other is blank; a credit line is indented,
 * as a voucher is written by hand.
 *
 * Not a `DataView`: these lines are one record's parts, not a list of records,
 * and have no order to sort or row to open.
 */
export function EntryLines({
  caption,
  lines,
}: {
  /** Names the table for assistive technology; not shown. */
  caption: string;
  lines: readonly EntryLine[];
}) {
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full text-caption">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-surface-sunken text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
            <th scope="col" className="px-3 py-1.5 text-left">
              Particulars
            </th>
            <th scope="col" className="px-3 py-1.5 text-right">
              Debit
            </th>
            <th scope="col" className="px-3 py-1.5 text-right">
              Credit
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            // A posting's lines have no id of their own; their order is fixed.
            <tr key={index} className="border-t border-border">
              <th
                scope="row"
                className={cn(
                  "px-3 py-1.5 text-left font-normal text-ink",
                  line.direction === "CREDIT" && "pl-8",
                )}
              >
                {line.particulars}
              </th>
              <td className="px-3 py-1.5 text-right text-ink" data-numeric>
                {line.direction === "DEBIT" ? formatCurrency(line.amount) : ""}
              </td>
              <td className="px-3 py-1.5 text-right text-ink" data-numeric>
                {line.direction === "CREDIT" ? formatCurrency(line.amount) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
