"use client";

import type { RouteDefinition } from "@repo/contracts";
import { ListPager } from "@repo/ui";

import type { PagedState } from "../lib/use-paged-query";

/**
 * A `usePagedQuery` result with the row type forgotten. The pager only counts
 * the rows, so it never needs to know what they are — and `PagedState<Route>`
 * holds `Route` only inside conditional types, which TypeScript cannot infer
 * back out of a `list` prop. Taking the paging members structurally is what
 * makes `<Pager list={customers} …/>` type-check at every call site.
 */
export type PagedList = Omit<
  Extract<PagedState<RouteDefinition>, { status: "ready" }>,
  "status" | "data" | "rows" | "reload"
> & { rows: readonly unknown[] };

/**
 * The pager under a console list: `<Pager list={customers} noun="customers"
 * nounSingular="customer" />`, passed to `DataView`'s `footer`.
 *
 * It is the whole of a list's paging on screen — a screen wires the state
 * once, here, rather than spreading eight props at every call site.
 */
export function Pager({
  list,
  noun,
  nounSingular,
}: {
  list: PagedList;
  /** Plural, lower case: "customers". */
  noun: string;
  nounSingular?: string;
}) {
  return (
    <ListPager
      page={list.page}
      pageCount={list.pageCount}
      total={list.total}
      shown={list.rows.length}
      pageSize={list.pageSize}
      noun={noun}
      nounSingular={nounSingular}
      onFirst={list.first}
      onPrevious={list.previous}
      onNext={list.next}
      onPageSize={list.setPageSize}
      busy={list.busy}
    />
  );
}
