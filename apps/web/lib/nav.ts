/**
 * Which navigation link the page belongs to: the longest `href` that is the
 * path or a parent of it. `/settings/audit` is the audit log, not business
 * settings, although `/settings` is a parent of it too.
 */
export function currentHref(
  pathname: string,
  hrefs: readonly string[],
): string | undefined {
  const path = sectionPath(pathname);
  let best: string | undefined;
  for (const href of hrefs) {
    const matches = path === href || path.startsWith(`${href}/`);
    if (matches && (best === undefined || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}

/**
 * Pages with no navigation item of their own, filed under the one they belong
 * to: an account (`/accounts/…`) is reached from its customer, so it is in
 * Customers (navigation-ia.md#admin-console-structure).
 */
export function sectionPath(pathname: string): string {
  return /^\/accounts(\/|$)/.test(pathname)
    ? `/customers${pathname}`
    : pathname;
}
