"use client";

import {
  collectionContract,
  type CollectionListItem,
  exportContract,
} from "@repo/contracts";
import {
  addCalendarDays,
  parseCalendarDate,
  toBusinessDate,
} from "@repo/domain";
import {
  Button,
  buttonClass,
  DataView,
  EmptyFrame,
  FilterBar,
  FilterField,
  formatBusinessDate,
  FormMessage,
  Input,
  ListFooter,
  NoMatches,
  NothingYet,
  PageHeader,
  Select,
} from "@repo/ui";
import Link from "next/link";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../components/columns";
import { ExportMenu } from "../../../components/export-menu";
import { LineFilter } from "../../../components/line-filter";
import { ListFallback } from "../../../components/list-state";
import { CollectionEntryBadge } from "../../../components/status-badge";
import { LIST_LIMIT } from "../../../lib/list-limit";
import { canManageOrganisation } from "../../../lib/roles";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { usePagedQuery } from "../../../lib/use-paged-query";
import { canApproveCorrections, signedAmount } from "./collection-parts";

/** The API allows a quarter per request; the default is the last week. */
const DEFAULT_DAYS = 7;
/** Inclusive business dates, at most 93 days apart (S-16). */
const MAX_RANGE_DAYS = 93;

/**
 * `from` and `to` are `""` by default, meaning "the last seven days up to
 * today" — worked out on the page, so the URL stays clean and a shared link
 * without dates follows the calendar.
 */
export const COLLECTION_FILTERS = { from: "", to: "", line: "", show: "" };

type Show = "" | "ORIGINAL" | "ADJUSTMENT";

/**
 * S-16 · Collection list — date-bounded, in the caller's scope (M02): the
 * organisation for Admins, their line for a Senior. Originals and corrections
 * side by side, so a correction is never out of sight of what it corrects.
 */
export function CollectionList({
  initial,
}: {
  initial: Partial<typeof COLLECTION_FILTERS>;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const { filters, setFilter, setFilters } = useListState(
    COLLECTION_FILTERS,
    initial,
  );
  const from =
    filters.from ||
    addCalendarDays(parseCalendarDate(today), -(DEFAULT_DAYS - 1));
  const to = filters.to || today;
  const lineId = manages ? filters.line : "";
  const kind = (
    ["ORIGINAL", "ADJUSTMENT"].includes(filters.show) ? filters.show : ""
  ) as Show;
  const filtered = lineId !== "" || kind !== "";

  const validRange = isValidRange(from, to);
  const query = {
    from,
    to,
    ...(lineId ? { lineId } : {}),
    ...(kind ? { entryType: kind } : {}),
  };
  const collections = usePagedQuery(
    collectionContract.listCollections,
    validRange ? { query: { limit: LIST_LIMIT, ...query } } : null,
  );

  const showToday = () => setFilters({ from: today, to: today });
  const clearFilters = () => setFilters({ line: "", show: "" });

  return (
    <>
      <PageHeader
        title="Collections"
        description={
          manages
            ? "Every collection and correction, by business date."
            : "Collections and corrections on your line."
        }
        actions={
          <>
            <ExportMenu
              route={exportContract.collections}
              query={query}
              disabled={!validRange}
            />
            {canApproveCorrections(me.role) ? (
              <Link
                href="/collections/pending-approval"
                className={buttonClass("secondary")}
              >
                Pending approvals
              </Link>
            ) : null}
          </>
        }
      />

      <FilterBar
        summary={[
          validRange
            ? `${formatBusinessDate(from)} to ${formatBusinessDate(to)}`
            : "Choose a date range",
          ...(manages ? [lineId ? "one line" : "all lines"] : []),
          kind === "ORIGINAL"
            ? "collections only"
            : kind === "ADJUSTMENT"
              ? "corrections only"
              : null,
        ]
          .filter(Boolean)
          .join(", ")}
      >
        <FilterField label="From" width="sm">
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </FilterField>
        <FilterField label="To" width="sm">
          <Input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </FilterField>
        {manages ? (
          <LineFilter
            value={lineId}
            onChange={(value) => setFilter("line", value)}
          />
        ) : null}
        <FilterField label="Show" width="lg">
          <Select
            value={kind}
            onChange={(event) => setFilter("show", event.target.value)}
          >
            <option value="">Collections and corrections</option>
            <option value="ORIGINAL">Collections only</option>
            <option value="ADJUSTMENT">Corrections only</option>
          </Select>
        </FilterField>
      </FilterBar>

      {!validRange ? (
        <EmptyFrame>
          <NoMatches
            title="Choose a date range"
            description="“From” must be on or before “To”, within 93 days."
            action={<Button onClick={showToday}>Show today</Button>}
          />
        </EmptyFrame>
      ) : collections.status === "ready" && collections.rows.length > 0 ? (
        <>
          <DataView
            caption="Collections"
            rows={collections.rows}
            getRowId={(entry) => entry.id}
            complete={!collections.hasMore}
            columns={[
              identityColumn<CollectionListItem>({
                header: "Customer",
                name: (entry) => entry.customerName,
                code: (entry) => entry.accountCode,
                href: (entry) =>
                  `/collections/${entry.adjustsCollectionId ?? entry.id}`,
              }),
              valueColumn<CollectionListItem>({
                id: "date",
                header: "Date",
                value: (entry) => entry.businessDate,
                cell: (entry) => formatBusinessDate(entry.businessDate),
              }),
              ...(manages
                ? [
                    valueColumn<CollectionListItem>({
                      id: "line",
                      header: "Line",
                      value: (entry) => entry.lineName,
                    }),
                  ]
                : []),
              valueColumn<CollectionListItem>({
                id: "collectedBy",
                header: "Collected by",
                value: (entry) => entry.collectedByName,
              }),
              moneyColumn<CollectionListItem>({
                id: "amount",
                header: "Amount",
                amount: (entry) => entry.amount,
                render: (entry) => (
                  <span className="tabular-nums" data-numeric>
                    {signedAmount(entry)}
                  </span>
                ),
                card: "headline",
              }),
              displayColumn<CollectionListItem>({
                id: "status",
                header: "Status",
                align: "end",
                card: "status",
                cell: (entry) => <CollectionEntryBadge entry={entry} />,
              }),
            ]}
            footer={
              <ListFooter
                shown={collections.rows.length}
                noun={collections.rows.length === 1 ? "entry" : "entries"}
                onMore={collections.loadMore}
                loadingMore={collections.loadingMore}
              />
            }
          />
          {collections.moreError ? (
            <FormMessage tone="critical">{collections.moreError}</FormMessage>
          ) : null}
        </>
      ) : (
        <ListFallback
          query={collections}
          columns={manages ? 6 : 5}
          empty={
            filtered ? (
              <NoMatches
                title="Nothing matches these filters"
                description="Try every line, or collections and corrections together."
                action={<Button onClick={clearFilters}>Clear filters</Button>}
              />
            ) : (
              <NothingYet
                title="No collections in these dates"
                description="Collections appear here once Juniors record them and they reach the office."
              />
            )
          }
        />
      )}
    </>
  );
}

/** `from` on or before `to`, and at most 93 days apart — the API's own rule. */
function isValidRange(from: string, to: string): boolean {
  if (from === "" || to === "" || from > to) return false;
  try {
    return (
      from >= addCalendarDays(parseCalendarDate(to), -(MAX_RANGE_DAYS - 1))
    );
  } catch {
    // A hand-edited URL with a malformed date.
    return false;
  }
}
