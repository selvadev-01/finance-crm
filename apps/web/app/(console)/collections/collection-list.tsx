"use client";

import { collectionContract, organisationContract as org } from "@repo/contracts";
import { addCalendarDays, parseCalendarDate, toBusinessDate } from "@repo/domain";
import {
  buttonClass,
  Button,
  DataTable,
  DataTableSkeleton,
  formatBusinessDate,
  Input,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { LIST_LIMIT, LoadFailed, Surface, TruncatedNote } from "../_organisation/list-controls";
import { canApproveCorrections, EntryBadge, signedAmount } from "./collection-parts";

/** The API allows a quarter per request; the default is the last week. */
const DEFAULT_DAYS = 7;

/**
 * S-16 · Collection list — date-bounded, in the caller's scope (M02): the
 * organisation for Admins, their line for a Senior. Originals and corrections
 * side by side, so a correction is never out of sight of what it corrects.
 */
export function CollectionList() {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const [from, setFrom] = useState<string>(addCalendarDays(parseCalendarDate(today), -(DEFAULT_DAYS - 1)));
  const [to, setTo] = useState<string>(today);
  const [lineId, setLineId] = useState("");
  const [kind, setKind] = useState<"" | "ORIGINAL" | "ADJUSTMENT">("");
  const filtered = lineId !== "" || kind !== "";

  const validRange = from !== "" && to !== "" && from <= to;
  const collections = useApiQuery(
    collectionContract.listCollections,
    validRange
      ? {
          query: {
            from,
            to,
            limit: LIST_LIMIT,
            ...(lineId ? { lineId } : {}),
            ...(kind ? { entryType: kind } : {}),
          },
        }
      : null,
  );
  const lines = useApiQuery(
    org.listLines,
    manages ? { query: { limit: LIST_LIMIT, includeInactive: "true" } } : null,
  );

  return (
    <>
      <PageHeader
        title="Collections"
        description={manages ? "Every collection and correction, by business date." : "Collections and corrections on your line."}
        actions={
          canApproveCorrections(me.role) ? (
            <Link href="/collections/pending-approval" className={buttonClass("secondary")}>
              Pending approvals
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-44">
          From
          <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-44">
          To
          <Input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
        </label>
        {manages ? (
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-56">
            Line
            <Select value={lineId} onChange={(event) => setLineId(event.target.value)}>
              <option value="">All lines</option>
              {lines.status === "ready"
                ? lines.data.data.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.name}
                      {line.isActive ? "" : " (inactive)"}
                    </option>
                  ))
                : null}
            </Select>
          </label>
        ) : null}
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-64">
          Show
          <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="">Collections and corrections</option>
            <option value="ORIGINAL">Collections only</option>
            <option value="ADJUSTMENT">Corrections only</option>
          </Select>
        </label>
      </div>

      {!validRange ? (
        <Surface>
          <NoMatches
            title="Choose a date range"
            description="“From” must be on or before “To”, within 93 days."
            action={<Button onClick={() => { setFrom(today); setTo(today); }}>Show today</Button>}
          />
        </Surface>
      ) : null}
      {collections.status === "loading" ? <DataTableSkeleton columns={5} /> : null}
      {collections.status === "error" ? (
        <LoadFailed message={collections.message} onRetry={collections.reload} />
      ) : null}

      {collections.status === "ready" && collections.data.data.length === 0 ? (
        <Surface>
          {filtered ? (
            <NoMatches
              title="Nothing matches these filters"
              description="Try every line, or collections and corrections together."
              action={
                <Button onClick={() => { setLineId(""); setKind(""); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <NothingYet
              title="No collections in these dates"
              description="Collections appear here once Juniors record them and they reach the office."
            />
          )}
        </Surface>
      ) : null}

      {collections.status === "ready" && collections.data.data.length > 0 ? (
        <>
          <DataTable
            caption="Collections"
            rows={collections.data.data}
            rowKey={(entry) => entry.id}
            columns={[
              {
                header: "Customer",
                cell: (entry) => (
                  <Link
                    href={`/collections/${entry.adjustsCollectionId ?? entry.id}`}
                    className="flex flex-col font-medium text-ink hover:text-accent hover:underline"
                  >
                    {entry.customerName}
                    <span className="font-mono text-2xs font-normal text-ink-muted">{entry.accountCode}</span>
                  </Link>
                ),
              },
              { header: "Date", cell: (entry) => formatBusinessDate(entry.businessDate) },
              ...(manages ? [{ header: "Line", cell: (entry: (typeof collections.data.data)[number]) => entry.lineName }] : []),
              { header: "Collected by", cell: (entry) => entry.collectedByName },
              {
                header: "Amount",
                align: "end",
                cell: (entry) => <span data-numeric>{signedAmount(entry)}</span>,
              },
              { header: "Status", align: "end", cell: (entry) => <EntryBadge entry={entry} /> },
            ]}
          />
          {collections.data.hasMore ? <TruncatedNote noun="collections" /> : null}
        </>
      ) : null}
    </>
  );
}
