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
  Card,
  FilterBar,
  FilterField,
  FormMessage,
  Input,
  ListFooter,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";

import { ListFallback } from "../../../../components/list-state";
import {
  ACTION_LABEL,
  ActionBadge,
  actorText,
  EntityRef,
  SnapshotDiff,
  TABLE_LABEL,
} from "../../../../lib/audit/audit-parts";
import { formatTimestamp } from "../../../../lib/format";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { usePagedQuery } from "../../../../lib/use-paged-query";

/** The audit log's filters; an empty string is "any". */
export const AUDIT_FILTERS = {
  action: "",
  entityTable: "",
  entityId: "",
  actorUserId: "",
  from: "",
  to: "",
};

export type AuditFilters = Partial<typeof AUDIT_FILTERS>;

const PAGE = 50;

/**
 * S-29 (US-090): the organization's audit log, newest first, read-only. Each
 * entry opens to show IP address, device and the recorded before and after.
 */
export function AuditLog({ initial }: { initial: AuditFilters }) {
  const { filters, setFilter, reset, filtered } = useListState(
    AUDIT_FILTERS,
    initial,
  );
  const staff = useApiQuery(staffContract.listStaff, { query: { limit: 200 } });
  const entries = usePagedQuery(auditContract.listAuditLog, {
    query: {
      limit: PAGE,
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

  const clear = (
    <Button tone="secondary" onClick={reset}>
      Clear filters
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Entries cannot be changed or removed."
        actions={filtered ? clear : null}
      />

      <form
        aria-label="Filter the audit log"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterBar>
          <FilterField label="Action" width="sm">
            <Select
              value={filters.action}
              onChange={(event) => setFilter("action", event.target.value)}
            >
              <option value="">Any action</option>
              {(Object.keys(ACTION_LABEL) as AuditAction[]).map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABEL[action]}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Record type" width="sm">
            <Select
              value={filters.entityTable}
              onChange={(event) => setFilter("entityTable", event.target.value)}
            >
              <option value="">Any record</option>
              {AUDITED_TABLES.map((table: AuditedTable) => (
                <option key={table} value={table}>
                  {TABLE_LABEL[table]}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Record id" width="md">
            <Input
              value={filters.entityId}
              placeholder="Any"
              onChange={(event) =>
                setFilter("entityId", event.target.value.trim())
              }
            />
          </FilterField>
          <FilterField label="Staff member" width="sm">
            <Select
              value={filters.actorUserId}
              onChange={(event) => setFilter("actorUserId", event.target.value)}
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
          <FilterField label="From" width="sm">
            <Input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilter("from", event.target.value)}
            />
          </FilterField>
          <FilterField label="To" width="sm">
            <Input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilter("to", event.target.value)}
            />
          </FilterField>
        </FilterBar>
      </form>

      {entries.status === "ready" && entries.rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2" data-testid="audit-entries">
            {entries.rows.map((entry) => (
              <AuditEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
          <ListFooter
            shown={entries.rows.length}
            noun={entries.rows.length === 1 ? "entry" : "entries"}
            onMore={entries.loadMore}
            loadingMore={entries.loadingMore}
          />
          {entries.moreError ? (
            <FormMessage tone="critical">{entries.moreError}</FormMessage>
          ) : null}
        </div>
      ) : (
        <ListFallback
          query={entries}
          columns={4}
          empty={
            filtered ? (
              <NoMatches
                title="No entries match"
                description="Nothing recorded matches these filters."
                action={clear}
              />
            ) : (
              <NothingYet
                title="Nothing recorded yet"
                description="Changes to customers, accounts, lines, cash and staff appear here."
              />
            )
          }
        />
      )}
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
      <Card.Root className="overflow-hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface-sunken/70 md:flex-row md:items-center md:gap-4">
            <span
              className="shrink-0 text-caption text-ink-muted tabular-nums md:w-44"
              data-numeric
            >
              {formatTimestamp(entry.createdAt)}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <ActionBadge action={entry.action} />
              <EntityRef table={entry.entityTable} id={entry.entityId} />
              {outcome ? (
                <span className="text-body text-ink-muted">
                  · {outcome.toLowerCase()}
                </span>
              ) : null}
            </span>
            <span className="text-label text-ink">{actorText(entry)}</span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border bg-surface-sunken/40 px-4 py-3">
            <SnapshotDiff before={entry.before} after={entry.after} />
            <dl className="grid gap-x-6 gap-y-1 text-body sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-muted">IP address</dt>
              <dd
                className={
                  entry.ipAddress
                    ? "font-mono text-2xs text-ink"
                    : "text-ink-muted"
                }
              >
                {entry.ipAddress ?? "Not recorded"}
              </dd>
              <dt className="text-ink-muted">Device</dt>
              <dd className="break-all text-ink">
                {entry.userAgent ?? "Not recorded"}
              </dd>
            </dl>
          </div>
        </details>
      </Card.Root>
    </li>
  );
}
