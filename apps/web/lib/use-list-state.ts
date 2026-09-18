"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export type ListFilters = Record<string, string>;

/**
 * A list's filters, kept in the URL so a reload, the back button or a shared
 * link shows the same rows (navigation-ia.md#url-state). Generalised from the
 * audit log.
 *
 * The page's server component reads `searchParams` with `readListParams` and
 * passes them in as `initial`; reading them here with `useSearchParams` would
 * force a Suspense boundary on every statically rendered page.
 *
 * `defaults` must be a module-level constant (its identity is a dependency),
 * and holds the values that mean "no filter". A filter equal to its
 * default is left out of the URL, and `filtered` is true only when something
 * differs — which is what chooses `NoMatches` over `NothingYet`.
 */
export function useListState<Filters extends ListFilters>(
  defaults: Filters,
  initial: Partial<Filters> = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, storeFilters] = useState<Filters>({
    ...defaults,
    ...initial,
  });

  const write = useCallback(
    (next: Filters) => {
      storeFilters(next);
      const params = new URLSearchParams(
        Object.entries(next).filter(
          ([key, value]) => value !== "" && value !== defaults[key],
        ),
      );
      router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, {
        scroll: false,
      });
    },
    [defaults, pathname, router],
  );

  const setFilter = useCallback(
    <Key extends keyof Filters & string>(key: Key, value: Filters[Key]) =>
      write({ ...filters, [key]: value }),
    [filters, write],
  );
  /** Several filters in one step — "every line, including inactive". */
  const setFilters = useCallback(
    (changes: Partial<Filters>) => write({ ...filters, ...changes }),
    [filters, write],
  );
  const reset = useCallback(() => write(defaults), [defaults, write]);
  const filtered = Object.entries(filters).some(
    ([key, value]) => value !== defaults[key],
  );

  return { filters, setFilter, setFilters, reset, filtered };
}
