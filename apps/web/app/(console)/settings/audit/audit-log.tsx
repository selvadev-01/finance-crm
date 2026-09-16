"use client";

import {
  AUDITED_TABLES,
  type AuditAction,
  auditContract,
  type AuditedTable,
  type AuditEntry,
  staffContract,
} from "@repo/contracts";
import {
  Button,
  DataTableSkeleton,
  Input,
  NoMatches,
  NothingYet,
  NotPermitted,
  PageHeader,
  Select,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ACTION_LABEL,
  ActionBadge,
  actorText,
  EntityRef,
  SnapshotDiff,
  TABLE_LABEL,
  WHEN,
} from "../../../../lib/audit/audit-parts";
import { useApiQuery } from "../../../../lib/use-api-query";
import { LoadFailed } from "../../_organisation/list-controls";

export interface AuditFilters {
  action?: string;
  entityTable?: string;
  entityId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

const PAGE = 50;

/**
 * S-29 (US-090): the organization's audit log, newest first, read-only. Each
 * entry opens to show IP address, device and the recorded before and after.
 */
export function AuditLog({ initial }: { initial: AuditFilters }) {
  const router = useRouter();
  const [filters, setFilters] = useState<AuditFilters>(initial);
  /** Cursors of the pages shown after the first; "Older entries" adds one. */
  const [cursors, setCursors] = useState<string[]>([]);
  const staff = useApiQuery(staffContract.listStaff, { query: { limit: 200 } });
  const filtered = Object.values(filters).some(Boolean);

  function change(key: keyof AuditFilters, value: string) {
    const next = { ...filters, [key]: value || undefined };
    setFilters(next);
    setCursors([]);
    const params = new URLSearchParams(
      Object.entries(next).filter((entry): entry is [string, string] =>
        Boolean(entry[1]),
      ),
    );
    router.replace(
      params.size > 0 ? `/settings/audit?${params}` : "/settings/audit",
      { scroll: false },
    );
  }

  function clear() {
    setFilters({});
    setCursors([]);
    router.replace("/settings/audit", { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Entries cannot be changed or removed."
        actions={
          filtered ? (
            <Button tone="secondary" onClick={clear}>
              Clear filters
            </Button>
          ) : null
        }
      />

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Filter the audit log"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterField label="Action">
          <Select
            value={filters.action ?? ""}
            onChange={(event) => change("action", event.target.value)}
          >
            <option value="">Any action</option>
            {(Object.keys(ACTION_LABEL) as AuditAction[]).map((action) => (
              <option key={action} value={action}>
                {ACTION_LABEL[action]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Record type">
          <Select
            value={filters.entityTable ?? ""}
            onChange={(event) => change("entityTable", event.target.value)}
          >
            <option value="">Any record</option>
            {AUDITED_TABLES.map((table: AuditedTable) => (
              <option key={table} value={table}>
                {TABLE_LABEL[table]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Record id">
          <Input
            value={filters.entityId ?? ""}
            placeholder="Any"
            onChange={(event) => change("entityId", event.target.value.trim())}
          />
        </FilterField>
        <FilterField label="Staff member">
          <Select
            value={filters.actorUserId ?? ""}
            onChange={(event) => change("actorUserId", event.target.value)}
          >
            <option value="">Anyone</option>
            {staff.status === "ready"
              ? staff.data.data.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name}
                  </option>
                ))
              : null}
          </Select>
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(event) => change("from", event.target.value)}
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(event) => change("to", event.target.value)}
          />
        </FilterField>
      </form>

      <div className="flex flex-col gap-2">
        <AuditPage
          filters={filters}
          cursor={null}
          isLast={cursors.length === 0}
          filtered={filtered}
          onClear={clear}
          onOlder={(cursor) => setCursors([cursor])}
        />
        {cursors.map((cursor, index) => (
          <AuditPage
            key={cursor}
            filters={filters}
            cursor={cursor}
            isLast={index === cursors.length - 1}
            filtered={filtered}
            onClear={clear}
            onOlder={(next) =>
              setCursors((shown) => [...shown.slice(0, index + 1), next])
            }
          />
        ))}
      </div>
    </>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

function AuditPage({
  filters,
  cursor,
  isLast,
  filtered,
  onClear,
  onOlder,
}: {
  filters: AuditFilters;
  cursor: string | null;
  isLast: boolean;
  filtered: boolean;
  onClear: () => void;
  onOlder: (cursor: string) => void;
}) {
  const page = useApiQuery(auditContract.listAuditLog, {
    query: {
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
      ...(filters.action ? { action: filters.action as AuditAction } : {}),
      ...(filters.entityTable
        ? { entityTable: filters.entityTable as AuditedTable }
        : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    },
  });

  if (page.status === "loading")
    return <DataTableSkeleton columns={4} rows={cursor ? 2 : 6} />;
  if (page.status === "not-permitted") return <NotPermitted />;
  if (page.status === "not-found") return null;
  if (page.status === "error") {
    return <LoadFailed message={page.message} onRetry={page.reload} />;
  }
  if (!cursor && page.data.data.length === 0) {
    return filtered ? (
      <NoMatches
        title="No entries match"
        description="Nothing recorded matches these filters."
        action={
          <Button tone="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <NothingYet
        title="Nothing recorded yet"
        description="Changes to customers, accounts, lines, cash and staff appear here."
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="audit-entries">
        {page.data.data.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {isLast && page.data.hasMore && page.data.nextCursor ? (
        <div>
          <Button
            tone="secondary"
            onClick={() => onOlder(page.data.nextCursor!)}
          >
            Older entries
          </Button>
        </div>
      ) : null}
    </>
  );
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const outcome =
    entry.action === "LOGIN"
      ? (entry.after?.outcome as string | undefined)
      : undefined;
  return (
    <li>
      <details className="group rounded-[var(--radius-surface)] border border-border bg-surface-raised">
        <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 hover:bg-surface-sunken md:flex-row md:items-center md:gap-4">
          <span className="shrink-0 text-sm text-ink-muted md:w-44" data-numeric>
            {WHEN.format(new Date(entry.createdAt))}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ActionBadge action={entry.action} />
            <EntityRef table={entry.entityTable} id={entry.entityId} />
            {outcome ? (
              <span className="text-sm text-ink-muted">
                · {outcome.toLowerCase()}
              </span>
            ) : null}
          </span>
          <span className="text-sm font-medium text-ink">
            {actorText(entry)}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <SnapshotDiff before={entry.before} after={entry.after} />
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-muted">IP address</dt>
            <dd className={entry.ipAddress ? "font-mono text-2xs text-ink" : "text-ink-muted"}>
              {entry.ipAddress ?? "Not recorded"}
            </dd>
            <dt className="text-ink-muted">Device</dt>
            <dd className="break-all text-ink">
              {entry.userAgent ?? "Not recorded"}
            </dd>
          </dl>
        </div>
      </details>
    </li>
  );
}
