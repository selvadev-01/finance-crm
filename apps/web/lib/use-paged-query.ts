"use client";

import type {
  RouteDefinition,
  RouteRequest,
  RouteSuccess,
} from "@repo/contracts";
import { useCallback, useRef, useState } from "react";

import { api } from "./api-client";
import { type QueryState, useApiQuery } from "./use-api-query";

/** How long a failed page waits before the lazy marker may ask again. */
const RETRY_AFTER_MS = 5_000;

type Page<Item> = { data: Item[]; nextCursor: string | null; hasMore: boolean };
type ItemOf<Route extends RouteDefinition> =
  RouteSuccess<Route> extends Page<infer Item> ? Item : never;
type WithQuery = { query?: Record<string, unknown> };

export type PagedState<Route extends RouteDefinition> = QueryState<Route> & {
  reload: () => void;
  /** Every row loaded so far, first page first. Empty until ready. */
  rows: ItemOf<Route>[];
  /** Whether the API has more rows than are loaded. */
  hasMore: boolean;
  /** Fetch the next page; absent when there is none. */
  loadMore?: () => void;
  loadingMore: boolean;
  /** A failed "Show more", shown beside the button. */
  moreError: string | null;
};

interface Extra<Item> {
  /** The first page these follow; a new first page discards them. */
  after: unknown;
  rows: Item[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * A cursor-paginated list (api-design.md#pagination): the first page through
 * `useApiQuery`, then "Show more" appends pages. Changing the request — a
 * filter — starts again from the first page. Nothing is sorted or filtered
 * here; the API's order stands.
 */
export function usePagedQuery<Route extends RouteDefinition>(
  route: Route,
  request: (RouteRequest<Route> & WithQuery) | null,
): PagedState<Route> {
  const first = useApiQuery(route, request);
  const [extra, setExtra] = useState<Extra<ItemOf<Route>> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const firstPage =
    first.status === "ready"
      ? (first.data as unknown as Page<ItemOf<Route>>)
      : null;
  const current =
    extra && firstPage && extra.after === firstPage ? extra : null;
  const rows = firstPage ? [...firstPage.data, ...(current?.rows ?? [])] : [];
  const hasMore = current ? current.hasMore : (firstPage?.hasMore ?? false);
  const cursor = current ? current.nextCursor : (firstPage?.nextCursor ?? null);

  // The next page loads by itself as the reader scrolls (ListFooter's lazy
  // marker), so two calls can land before `loadingMore` renders: the ref
  // keeps them to one request. After a failure the marker, still in view,
  // would ask again at once; it waits a moment instead of hammering the API.
  const inFlight = useRef(false);
  const failedAt = useRef(0);

  const loadMore = useCallback(() => {
    if (!request || !firstPage || !cursor || inFlight.current) return;
    if (Date.now() - failedAt.current < RETRY_AFTER_MS) return;
    inFlight.current = true;
    setLoadingMore(true);
    setMoreError(null);
    const next = {
      ...request,
      query: { ...request.query, cursor },
    } as RouteRequest<Route>;
    api(route, next)
      .then((result) => {
        if (!result.ok) {
          failedAt.current = Date.now();
          setMoreError("More couldn’t be loaded just now. Try again.");
          return;
        }
        const page = result.body as unknown as Page<ItemOf<Route>>;
        setExtra((previous) => ({
          after: firstPage,
          rows: [
            ...(previous && previous.after === firstPage ? previous.rows : []),
            ...page.data,
          ],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        }));
      })
      .catch(() => {
        failedAt.current = Date.now();
        setMoreError(
          "Could not reach Rasi. Check your connection and try again.",
        );
      })
      .finally(() => {
        inFlight.current = false;
        setLoadingMore(false);
      });
  }, [request, firstPage, cursor, route]);

  const reload = useCallback(() => {
    setExtra(null);
    first.reload();
  }, [first]);

  return {
    ...first,
    reload,
    rows,
    hasMore,
    loadMore: hasMore && cursor ? loadMore : undefined,
    loadingMore,
    moreError,
  };
}
