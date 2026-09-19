/**
 * Which navigation link the page belongs to: the longest `href` that is the
 * path or a parent of it. `/settings/audit` is the audit log, not business
 * settings, although `/settings` is a parent of it too.
 */
export function currentHref(
  pathname: string,
  hrefs: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === undefined || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
