/**
 * Sector and line codes are issued here, never typed (US-010, US-011). They are
 * unique per organization at the database ([ADR-0012](../../../../docs/02-architecture/adr/0012-organization-sign-up.md))
 * and immutable once written, which is exactly why nobody should have to invent
 * one at a dialog: a typo is permanent.
 */

export const SECTOR_CODE_PREFIX = 'SEC';
export const LINE_CODE_PREFIX = 'LIN';

/**
 * How many times a create is retried when two Admins pick the same number at
 * the same moment. The unique index is the arbiter; this is the loser's retry.
 */
export const CODE_ATTEMPTS = 5;

/**
 * The next code for `prefix`: one past the highest already issued in the
 * organization, five digits, growing past them rather than wrapping — the same
 * shape as a customer code (`CUS-00417`).
 *
 * Codes that do not carry a number after the prefix are ignored rather than
 * treated as zero, so an organization holding codes from elsewhere — a seed, an
 * import, a test fixture — starts its issued codes at 1 and never collides with
 * them, because those codes are not of this shape.
 */
export function nextCode(prefix: string, used: { code: string }[]): string {
  const highest = used.reduce((max, { code }) => {
    const value = Number(code.slice(prefix.length + 1));
    return Number.isSafeInteger(value) && value > max ? value : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(5, '0')}`;
}

/** Matches every code this module has issued for `prefix`, and only those. */
export function issuedCodes(prefix: string) {
  return { startsWith: `${prefix}-` };
}
