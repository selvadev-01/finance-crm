"use client";

import type { AuditAction, AuditEntry, AuditedTable } from "@repo/contracts";
import Link from "next/link";

import { StatusBadge, statusLabel } from "../../components/status-badge";
import { formatTimestamp } from "../format";

/** The action's words, from the status registry (`auditAction`). */
export const ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: statusLabel("auditAction", "CREATE"),
  UPDATE: statusLabel("auditAction", "UPDATE"),
  DELETE: statusLabel("auditAction", "DELETE"),
  APPROVE: statusLabel("auditAction", "APPROVE"),
  REJECT: statusLabel("auditAction", "REJECT"),
  LOGIN: statusLabel("auditAction", "LOGIN"),
  REOPEN_DAY: statusLabel("auditAction", "REOPEN_DAY"),
};

export const TABLE_LABEL: Record<AuditedTable, string> = {
  user: "Sign-in account",
  staff_profile: "Staff member",
  sector: "Sector",
  line: "Line",
  line_assignment: "Line assignment",
  customer: "Customer",
  account_loan: "Account",
  collection: "Collection",
  day_close: "Day close",
  cash_handover: "Cash handover",
  ledger_account: "Ledger account",
  holiday: "Holiday",
};

export function tableLabel(table: string): string {
  return TABLE_LABEL[table as AuditedTable] ?? table;
}

/** Only tables with a console page link; the rest show their id. */
const ENTITY_HREF: Partial<Record<AuditedTable, (id: string) => string>> = {
  customer: (id) => `/customers/${id}`,
  account_loan: (id) => `/accounts/${id}`,
  collection: (id) => `/collections/${id}`,
  line: (id) => `/lines/${id}`,
  sector: (id) => `/sectors/${id}`,
  staff_profile: (id) => `/team/${id}`,
};

/**
 * Audit times are instants, shown in the business time zone.
 *
 * @deprecated Call `formatTimestamp(instant)` from `lib/format.ts`. Kept, as a
 * thin wrapper over it, for callers not yet moved.
 */
export const WHEN = {
  format: (instant: Date | string): string => formatTimestamp(instant, "full"),
};

/** An audit action, in the tone the status registry gives it. */
export function ActionBadge({ action }: { action: AuditAction }) {
  return <StatusBadge kind="auditAction" value={action} />;
}

export function EntityRef({ table, id }: { table: string; id: string }) {
  const href = ENTITY_HREF[table as AuditedTable]?.(id);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="text-body text-ink">{tableLabel(table)}</span>
      {href ? (
        <Link
          href={href}
          className="font-mono text-2xs break-all text-accent underline-offset-4 hover:underline"
        >
          {id}
        </Link>
      ) : (
        <span className="font-mono text-2xs break-all text-ink-muted">
          {id}
        </span>
      )}
    </span>
  );
}

function show(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "empty";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Before and after, field by field. Values are shown as recorded — money is
 * already a decimal string in the snapshot and is never reformatted here.
 */
export function SnapshotDiff({
  before,
  after,
}: Pick<AuditEntry, "before" | "after">) {
  const fields = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  if (fields.length === 0)
    return (
      <p className="text-body text-ink-muted">No field values were recorded.</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-md border-collapse text-left text-body">
        <thead>
          <tr className="border-b border-border text-2xs tracking-wider text-ink-subtle uppercase">
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Field
            </th>
            {before ? (
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Before
              </th>
            ) : null}
            <th scope="col" className="py-1.5 font-medium">
              {before ? "After" : "Value"}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const was = before?.[field];
            const now = after?.[field];
            const changed = before !== null && show(was) !== show(now);
            return (
              <tr
                key={field}
                className="border-b border-border align-top last:border-b-0"
              >
                <th
                  scope="row"
                  className="py-1.5 pr-4 font-mono text-2xs font-normal text-ink-muted"
                >
                  {field}
                </th>
                {before ? (
                  <td className="py-1.5 pr-4 break-all text-ink-muted tabular-nums">
                    {show(was)}
                  </td>
                ) : null}
                <td
                  className={
                    changed
                      ? "py-1.5 break-all font-medium text-ink tabular-nums"
                      : "py-1.5 break-all text-ink tabular-nums"
                  }
                >
                  {show(now)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Who did it: a person, the system, or nobody known (an unknown sign-in). */
export function actorText(entry: Pick<AuditEntry, "actor" | "system">): string {
  if (entry.actor) return entry.actor.name;
  return entry.system ? "System" : "Unknown user";
}
