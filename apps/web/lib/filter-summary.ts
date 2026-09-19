/**
 * What a folded filter bar says on a phone (design-system.md, `FilterBar`)
 * for a list with too many filters to name one by one: how many are set.
 * Empty values are unset — the same rule `useListState` uses.
 */
export function filterCountSummary(
  filters: Record<string, string>,
  whenNone: string,
): string {
  const set = Object.values(filters).filter((value) => value !== "").length;
  if (set === 0) return whenNone;
  return `${set} ${set === 1 ? "filter" : "filters"} set`;
}
