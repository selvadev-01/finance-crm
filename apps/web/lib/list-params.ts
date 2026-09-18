/**
 * The string-valued search params a list page knows about, read in its server
 * component and handed to `useListState` as `initial`. Anything else in the
 * URL is ignored.
 */
export function readListParams<Key extends string>(
  params: Record<string, string | string[] | undefined>,
  keys: readonly Key[],
): Partial<Record<Key, string>> {
  const found: Partial<Record<Key, string>> = {};
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value !== "") found[key] = value;
  }
  return found;
}
