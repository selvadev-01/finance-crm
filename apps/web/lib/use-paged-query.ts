"use client";

import type {
  RouteDefinition,
  RouteRequest,
  RouteSuccess,
} from "@repo/contracts";
import { PAGE_SIZES } from "@repo/ui";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { type QueryState, useApiQuery } from "./use-api-query";

/**
 * Rows per page until the reader chooses otherwise, and the size that is left
 * out of the URL. Not `pageQuerySchema`'s default of 50 — that one is for a
 * caller who names no limit, and this hook always names one.
 */
export const DEFAULT_PAGE_SIZE = 10;

type Page<Item> = {
  data: Item[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
};
type ItemOf<Route extends RouteDefinition> =
  RouteSuccess<Route> extends Page<infer Item> ? Item : never;
type WithQuery = { query?: Record<string, unknown> };

/**
 * The three search params a paged list owns — `page`, `after` and `size`.
 * Filters own everything else in the URL, and `readListParams` never reads
 * these: they are read here, at mount, from the browser's own location.
 *
 * Not `useSearchParams`, which would force a Suspense boundary onto every
 * statically rendered list page (the same reason `useListState` takes its
 * filters as a prop). Nothing is rendered from them before the rows arrive —
 * the server and the first client render both draw the skeleton — so reading
 * the location here cannot make the markup disagree at hydration.
 */
function readPageParams(): {
  page: number;
  after: string | null;
  size: number;
} {
  if (typeof window === "undefined") {
    return { page: 1, after: null, size: DEFAULT_PAGE_SIZE };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    page: Number(params.get("page")),
    after: params.get("after"),
    size: readSize(params.get("size") ?? undefined),
  };
}

export type PagedState<Route extends RouteDefinition> = QueryState<Route> & {
  reload: () => void;
  /** The rows of the current page — not every row read so far. */
  rows: ItemOf<Route>[];
  /** Every row the filter matches, counted by the API under the same scope. */
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Absent when that step cannot be taken; the pager disables the control. */
  first?: () => void;
  previous?: () => void;
  next?: () => void;
  setPageSize: (size: number) => void;
  /** A page change is in flight; the rows on screen are the previous page's. */
  busy: boolean;
};

interface Paging {
  /** The request these pages belong to. A new one starts again at page 1. */
  key: string | null;
  page: number;
  /**
   * `trail[i]` is the cursor that starts page `i + 1`; page 1's is `null`.
   * `undefined` is a page whose cursor this browser never held — arriving
   * straight at page 5 from a shared link, where only page 5's cursor is in
   * the URL. That is what makes "Previous" unavailable but "First" always
   * available: a cursor is walked to, never computed.
   */
  trail: (string | null | undefined)[];
  size: number;
}

/** Everything but the paging, which is what a page reset keys on. */
function requestKey(request: (RouteRequest<never> & WithQuery) | null) {
  if (request === null) return null;
  const { query, ...rest } = request as WithQuery & Record<string, unknown>;
  const { cursor: _cursor, limit: _limit, ...filters } = query ?? {};
  return JSON.stringify({ ...rest, query: filters });
}

function readSize(raw: string | undefined) {
  const size = Number(raw);
  return PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number])
    ? size
    : DEFAULT_PAGE_SIZE;
}

/**
 * A cursor-paginated list read a page at a time (api-design.md#pagination):
 * the reader steps First / Previous / Next and is told where they are, out of
 * how many. The API still issues cursors — a page is *walked* to, never
 * addressed by offset, because collections are inserted all day and an offset
 * would skip or repeat rows underneath the reader.
 *
 * Do not pass `limit` or `cursor` in the request; this hook owns both. Change
 * anything else — a filter — and the list starts again at page 1.
 *
 * With `url: true` the page is kept in the URL (`?page=2&after=<cursor>`, and
 * `size` when it is not the default), so a reload or a shared link opens the
 * same page. Leave it off for a list inside a detail page, where several lists
 * would fight over the same three params.
 *
 * While the next page is fetched the previous one stays on screen with `busy`
 * set, rather than the table collapsing to a skeleton on every step.
 */
export function usePagedQuery<Route extends RouteDefinition>(
  route: Route,
  request: (RouteRequest<Route> & WithQuery) | null,
  options: { url?: boolean } = {},
): PagedState<Route> {
  const { url = false } = options;
  const router = useRouter();
  const pathname = usePathname();
  const key = requestKey(request as (RouteRequest<never> & WithQuery) | null);

  const [paging, setPaging] = useState<Paging>(() => {
    const { page, after, size } = url
      ? readPageParams()
      : { page: 1, after: null, size: DEFAULT_PAGE_SIZE };
    // A page above 1 is only believable with the cursor that starts it.
    return Number.isInteger(page) && page > 1 && after
      ? { key, page, trail: [...Array<undefined>(page - 1), after], size }
      : { key, page: 1, trail: [null], size };
  });

  // A changed filter makes the current page meaningless — page 4 of the old
  // list is not page 4 of the new one. Adjusting during the render keeps the
  // first request of the new list from being the old page's cursor.
  if (paging.key !== key) {
    setPaging({ key, page: 1, trail: [null], size: paging.size });
  }

  const cursor = paging.trail[paging.page - 1] ?? undefined;
  const pageRequest =
    request === null
      ? null
      : ({
          ...request,
          query: {
            ...(request as WithQuery).query,
            limit: paging.size,
            ...(cursor ? { cursor } : {}),
          },
        } as RouteRequest<Route>);

  const query = useApiQuery(route, pageRequest);

  // The last answer for this same list, kept so stepping between pages does
  // not blink the table away and back.
  const [held, setHeld] = useState<{
    key: string | null;
    data: RouteSuccess<Route>;
  } | null>(null);
  if (query.status === "ready" && held?.data !== query.data) {
    setHeld({ key, data: query.data });
  } else if (held !== null && query.status !== "ready" && held.key !== key) {
    setHeld(null);
  }

  const settled =
    query.status === "ready"
      ? query.data
      : held !== null && query.status === "loading"
        ? held.data
        : null;
  const busy = query.status === "loading" && settled !== null;

  const page = settled as Page<ItemOf<Route>> | null;
  const rows = page?.data ?? [];
  const total = page?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / paging.size));

  const goFirst = useCallback(
    () => setPaging((was) => ({ ...was, page: 1, trail: [null] })),
    [],
  );
  const goPrevious = useCallback(
    () => setPaging((was) => ({ ...was, page: Math.max(1, was.page - 1) })),
    [],
  );
  const nextCursor = page?.nextCursor ?? null;
  const goNext = useCallback(() => {
    if (nextCursor === null) return;
    setPaging((was) => {
      const trail = [...was.trail];
      trail[was.page] = nextCursor;
      return { ...was, page: was.page + 1, trail };
    });
  }, [nextCursor]);
  // A different page size makes every cursor in the trail the wrong boundary,
  // so the list starts again rather than pretending page 3 survives.
  const setPageSize = useCallback(
    (size: number) => setPaging({ key, page: 1, trail: [null], size }),
    [key],
  );

  // A page the rows have moved out from under — the last row of page 3 was
  // corrected away, so page 3 is now past the end. Land on something real
  // rather than showing an empty table with a page number on it. Adjusted
  // during the render, like the filter reset above: an effect would render
  // the empty page first and then replace it.
  if (query.status === "ready" && paging.page > 1 && rows.length === 0) {
    setPaging((was) =>
      was.page > 1 ? { ...was, page: 1, trail: [null] } : was,
    );
  }

  // The URL follows the pager, and only ever these three params: a filter
  // rewrites the URL from its own state, which drops them — which is correct,
  // since that filter has just sent the reader back to page 1.
  useEffect(() => {
    if (!url) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = new URLSearchParams(params);
    const cursorNow = paging.trail[paging.page - 1];
    if (paging.page > 1 && cursorNow) {
      wanted.set("page", String(paging.page));
      wanted.set("after", cursorNow);
    } else {
      wanted.delete("page");
      wanted.delete("after");
    }
    if (paging.size === DEFAULT_PAGE_SIZE) wanted.delete("size");
    else wanted.set("size", String(paging.size));
    if (wanted.toString() === params.toString()) return;
    router.replace(wanted.size > 0 ? `${pathname}?${wanted}` : pathname, {
      scroll: false,
    });
  }, [url, paging, pathname, router]);

  const reload = query.reload;

  return {
    ...query,
    ...(settled !== null && query.status !== "ready"
      ? { status: "ready" as const, data: settled }
      : {}),
    reload,
    rows,
    total,
    page: paging.page,
    pageCount,
    pageSize: paging.size,
    first: paging.page > 1 ? goFirst : undefined,
    previous:
      paging.page > 1 && paging.trail[paging.page - 2] !== undefined
        ? goPrevious
        : undefined,
    next: page?.hasMore && nextCursor !== null ? goNext : undefined,
    setPageSize,
    busy,
  } as PagedState<Route>;
}
