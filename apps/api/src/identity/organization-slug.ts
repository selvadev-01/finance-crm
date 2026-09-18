import { randomBytes } from 'node:crypto';

/**
 * Organization slugs (ADR-0012) — generated from the business name, never
 * typed. The database holds the final word: `organization_slug_key` (unique)
 * and `organization_slug_format_check` (shape, 3–63 characters).
 */

/** Room for a `-NN` suffix inside the 63-character limit. */
const MAX_BASE_LENGTH = 48;
const MIN_LENGTH = 3;

/**
 * Words a slug may never be, because `/<slug>/sign-in` would shadow or be
 * confused with a real route, or would impersonate the product. Every
 * top-level segment of `apps/web/app` belongs here — add one when a route is.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // apps/web top-level routes
  'accounts',
  'cash',
  'change-password',
  'collections',
  'customers',
  'dashboard',
  'design-system',
  'home',
  'lines',
  'notifications',
  'reports',
  'route',
  'sectors',
  'serwist',
  'settings',
  'sign-in',
  'sign-up',
  'team',
  // API, platform and framework paths
  '_next',
  'api',
  'auth',
  'health',
  'static',
  'sw',
  // Impersonation and future use
  'admin',
  'administrator',
  'app',
  'billing',
  'help',
  'login',
  'logout',
  'me',
  'new',
  'org',
  'orgs',
  'rasi',
  'register',
  'root',
  'security',
  'signin',
  'signup',
  'staff',
  'support',
  'system',
  'www',
]);

const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The same rule as `organization_slug_format_check`. */
export function isValidSlug(slug: string): boolean {
  return (
    SLUG_SHAPE.test(slug) && slug.length >= MIN_LENGTH && slug.length <= 63
  );
}

/**
 * `"Śrī Lakshmi Finance & Co."` → `"sri-lakshmi-finance-co"`.
 *
 * Accents are folded (NFKD, combining marks dropped); anything else that is
 * not an ASCII letter or digit separates words. Returns `null` when too little
 * survives — a name written entirely in Tamil script, say — so the caller
 * falls back to a random slug rather than inventing a meaningless one.
 */
export function slugFromName(name: string): string | null {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug.length >= MIN_LENGTH ? slug : null;
}

/** `org-` and eight random hex characters. */
export function randomSlug(): string {
  return `org-${randomBytes(4).toString('hex')}`;
}

/**
 * The first free slug for a base: the base itself, then `-2`, `-3`, … among
 * those `taken` does not hold. A reserved base starts at `-2`, as though it
 * were taken. Past 99 collisions the name is too common to number further, and
 * a random suffix is used instead.
 */
export function firstFreeSlug(
  base: string,
  taken: ReadonlySet<string>,
): string {
  if (!RESERVED_SLUGS.has(base) && !taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}
