"use client";

import { EmptyFrame, ListSkeleton, NotPermitted } from "@repo/ui";
import type { ReactNode } from "react";

import { LoadFailed } from "./query-state";

type ListQuery =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "not-found" }
  | { status: "not-permitted" }
  | { status: "error"; message: string };

/**
 * Everything a list shows when it is not showing rows: its loading shape, a
 * failed read, a scope refusal, or — once ready and empty — the empty state
 * the screen chose. The screen renders its `DataView` itself when there are
 * rows, so the rows stay typed:
 *
 *   {rows.length > 0 ? <DataView … /> : <ListFallback query={q} columns={4} empty={…} />}
 *
 * `empty` is `NothingYet` or `NoMatches` — only the screen knows which
 * (design-system.md#three-empty-states-not-one).
 */
export function ListFallback({
  query,
  empty,
  columns = 4,
}: {
  query: ListQuery & { reload: () => void };
  empty: ReactNode;
  /** How many columns the loading skeleton draws. */
  columns?: number;
}) {
  switch (query.status) {
    case "loading":
      return <ListSkeleton columns={columns} />;
    case "error":
      return <LoadFailed message={query.message} onRetry={query.reload} />;
    case "not-found":
    case "not-permitted":
      return (
        <EmptyFrame>
          <NotPermitted />
        </EmptyFrame>
      );
    case "ready":
      return <EmptyFrame>{empty}</EmptyFrame>;
  }
}
