"use client";

import {
  type SecurityEvent,
  type SecurityEventKind,
  securityContract,
  staffContract,
} from "@repo/contracts";
import {
  Badge,
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
import { STATUS, StatusBadge } from "../../../../components/status-badge";
import { EntityRef } from "../../../../lib/audit/audit-parts";
import { formatTimestamp } from "../../../../lib/format";
import { ROLE_LABEL } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { usePagedQuery } from "../../../../lib/use-paged-query";

/** The security log's filters; an empty string is "any". */
export const SECURITY_FILTERS = {
  kind: "",
  code: "",
  actorUserId: "",
  from: "",
  to: "",
};

export type SecurityFilters = Partial<typeof SECURITY_FILTERS>;

const PAGE = 50;

const KINDS = Object.keys(STATUS.securityEvent) as SecurityEventKind[];

/**
 * S-31: the attempts the API refused, newest first, read-only.
 *
 * It sits beside the audit log because the two answer halves of one question.
 * The audit log says what changed; this says what somebody tried to change and
 * was not allowed to — the half that leaves no other trace.
 */
export function SecurityEvents({ initial }: { initial: SecurityFilters }) {
  const { filters, setFilter, reset, filtered } = useListState(
    SECURITY_FILTERS,
    initial,
  );
  const staff = useApiQuery(staffContract.listStaff, { query: { limit: 200 } });
  const events = usePagedQuery(securityContract.listSecurityEvents, {
    query: {
      limit: PAGE,
      ...(filters.kind ? { kind: filters.kind as SecurityEventKind } : {}),
      ...(filters.code ? { code: filters.code } : {}),
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
        title="Refused attempts"
        description="Actions the system turned away: a role reaching past what it may do, or an id that was not theirs to open."
        actions={filtered ? clear : null}
      />

      <form
        aria-label="Filter the refused attempts"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterBar>
          <FilterField label="Reason" width="md">
            <Select
              value={filters.kind}
              onChange={(event) => setFilter("kind", event.target.value)}
            >
              <option value="">Any reason</option>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {STATUS.securityEvent[kind].label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Refusal code" width="md">
            <Input
              value={filters.code}
              placeholder="Any"
              onChange={(event) =>
                setFilter("code", event.target.value.trim().toUpperCase())
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

      {events.status === "ready" && events.rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2" data-testid="security-events">
            {events.rows.map((event) => (
              <SecurityEventRow key={event.id} event={event} />
            ))}
          </ul>
          <ListFooter
            shown={events.rows.length}
            noun={events.rows.length === 1 ? "attempt" : "attempts"}
            onMore={events.loadMore}
            loadingMore={events.loadingMore}
          />
          {events.moreError ? (
            <FormMessage tone="critical">{events.moreError}</FormMessage>
          ) : null}
        </div>
      ) : (
        <ListFallback
          query={events}
          columns={4}
          empty={
            filtered ? (
              <NoMatches
                title="No attempts match"
                description="Nothing refused matches these filters."
                action={clear}
              />
            ) : (
              <NothingYet
                title="Nothing refused"
                description="Nobody has been turned away from an action they may not perform."
              />
            )
          }
        />
      )}
    </>
  );
}

function SecurityEventRow({ event }: { event: SecurityEvent }) {
  const facts = Object.entries(event.detail ?? {});
  return (
    <li>
      <Card.Root className="overflow-hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface-sunken/70 md:flex-row md:items-center md:gap-4">
            <span
              className="shrink-0 text-caption text-ink-muted tabular-nums md:w-44"
              data-numeric
            >
              {formatTimestamp(event.createdAt)}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <StatusBadge kind="securityEvent" value={event.kind} />
              {event.targetTable && event.targetId ? (
                <EntityRef table={event.targetTable} id={event.targetId} />
              ) : (
                <span className="font-mono text-2xs break-all text-ink-muted">
                  {event.method} {event.path}
                </span>
              )}
            </span>
            <span className="text-label text-ink">
              {event.actor.name}
              <span className="text-ink-muted">
                {" "}
                · {ROLE_LABEL[event.actor.role]}
              </span>
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border bg-surface-sunken/40 px-4 py-3">
            <dl className="grid gap-x-6 gap-y-1 text-body sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-muted">Route</dt>
              <dd className="font-mono text-2xs break-all text-ink">
                {event.method} {event.path}
              </dd>
              <dt className="text-ink-muted">Answered with</dt>
              <dd className="text-ink">
                <Badge tone="neutral">{event.status}</Badge>{" "}
                <span className="font-mono text-2xs break-all">
                  {event.code}
                </span>
              </dd>
              {facts.map(([field, value]) => (
                <Fact key={field} field={field} value={value} />
              ))}
              <dt className="text-ink-muted">IP address</dt>
              <dd
                className={
                  event.ipAddress
                    ? "font-mono text-2xs text-ink"
                    : "text-ink-muted"
                }
              >
                {event.ipAddress ?? "Not recorded"}
              </dd>
              <dt className="text-ink-muted">Device</dt>
              <dd className="break-all text-ink">
                {event.userAgent ?? "Not recorded"}
              </dd>
            </dl>
          </div>
        </details>
      </Card.Root>
    </li>
  );
}

/** One recorded fact about the attempt — never a request body (M13). */
function Fact({ field, value }: { field: string; value: unknown }) {
  return (
    <>
      <dt className="font-mono text-2xs text-ink-muted">{field}</dt>
      <dd className="break-all text-ink">
        {typeof value === "string" ? value : JSON.stringify(value)}
      </dd>
    </>
  );
}
