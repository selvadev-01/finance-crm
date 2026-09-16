"use client";

import type { AuditAction, AuditEntry, AuditedTable } from "@repo/contracts";
import { Badge, type BadgeProps } from "@repo/ui";
import Link from "next/link";

export const ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: "Created",
  UPDATE: "Changed",
  DELETE: "Deleted",
  APPROVE: "Approved",
  REJECT: "Rejected",
  LOGIN: "Sign-in",
  REOPEN_DAY: "Day reopened",
};

const ACTION_TONE: Record<AuditAction, NonNullable<BadgeProps["tone"]>> = {
  CREATE: "positive",
  UPDATE: "info",
  DELETE: "critical",
  APPROVE: "positive",
  REJECT: "critical",
  LOGIN: "neutral",
  REOPEN_DAY: "warning",
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

/** Audit times are instants, shown in the business time zone. */
export const WHEN = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "medium",
});

export function ActionBadge({ action }: { action: AuditAction }) {
  // Warning and info words fail AA on their subtle fills (design-system.md).
  return (
    <Badge tone={ACTION_TONE[action]} className="text-ink">
      {ACTION_LABEL[action]}
    </Badge>
  );
}

export function EntityRef({ table, id }: { table: string; id: string }) {
  const href = ENTITY_HREF[table as AuditedTable]?.(id);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <span className="text-sm text-ink">{tableLabel(table)}</span>
      {href ? (
        <Link
          href={href}
          className="font-mono text-2xs break-all text-accent hover:underline"
        >
          {id}
        </Link>
      ) : (
        <span className="font-mono text-2xs break-all text-ink-muted">{id}</span>
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
      <p className="text-sm text-ink-muted">No field values were recorded.</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-md text-left text-sm">
        <thead>
          <tr className="text-2xs tracking-wide text-ink-muted uppercase">
            <th scope="col" className="py-1 pr-4 font-medium">
              Field
            </th>
            {before ? (
              <th scope="col" className="py-1 pr-4 font-medium">
                Before
              </th>
            ) : null}
            <th scope="col" className="py-1 font-medium">
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
              <tr key={field} className="border-t border-border align-top">
                <th
                  scope="row"
                  className="py-1.5 pr-4 font-mono text-2xs font-normal text-ink-muted"
                >
                  {field}
                </th>
                {before ? (
                  <td className="py-1.5 pr-4 break-all text-ink-muted">
                    {show(was)}
                  </td>
                ) : null}
                <td
                  className={
                    changed
                      ? "py-1.5 break-all font-medium text-ink"
                      : "py-1.5 break-all text-ink"
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
