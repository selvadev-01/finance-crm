import type { SecurityEventKind } from '@repo/db';

import { AppError } from '../platform/errors/errors.js';

/**
 * Which refusals are worth keeping, and what they mean (M13, ADR-0014).
 *
 * The list is deliberately short. A security log is only useful if reading it
 * is a small job, so it holds refusals that say something about **intent** —
 * someone reaching past the boundary of their role — and nothing that happens
 * in ordinary use.
 *
 * What is **not** here, and why:
 *
 * - **Validation, conflict and "unchanged" refusals** (`EMAIL_TAKEN`,
 *   `ROLE_UNCHANGED`, `SETTING_VALUE_INVALID`, …). A mistyped form is not an
 *   attack, and the audit log already shows what the successful retry did.
 * - **`UNAUTHENTICATED` and `STAFF_NOT_ACTIVE`.** There is no resolved caller
 *   to name — an expired session produces them constantly, and a failed sign-in
 *   is already a `LOGIN` audit entry with its outcome (M01).
 * - **Ordinary out-of-scope 404s** — a Senior opening another line's customer,
 *   account or collection. Those are routine: a bookmark, a notification deep
 *   link opened after a reassignment, a phone replaying an id from its outbox.
 *   Recording them would bury the handful of rows that matter under thousands
 *   that do not, and a log nobody can read is worse than no log at all. The two
 *   404s that **are** kept — `STAFF_NOT_FOUND` and `SETTING_NOT_FOUND` — sit on
 *   administration routes whose ids are never handed around in normal work, so
 *   a miss there is someone guessing at what else exists.
 */
export const SECURITY_REFUSALS: Readonly<
  Record<string, { kind: SecurityEventKind; targetTable?: string }>
> = {
  // M02 — the role does not hold the route's permission at all.
  PERMISSION_DENIED: { kind: 'PERMISSION_DENIED' },

  // M01 rule 1 — never a role above your own, on the role or on the person.
  ROLE_ABOVE_OWN: { kind: 'RANK_GUARD', targetTable: 'staff_profile' },
  CANNOT_MANAGE_HIGHER_ROLE: {
    kind: 'RANK_GUARD',
    targetTable: 'staff_profile',
  },

  // M01 rule 1 again, by the side door: an Admin reaching for the owner's
  // account through a password reset is the takeover the rule exists to stop.
  CANNOT_RESET_SUPER_ADMIN: {
    kind: 'RANK_GUARD',
    targetTable: 'staff_profile',
  },

  // M01 rule 2 — never yourself.
  CANNOT_CHANGE_OWN_ROLE: { kind: 'SELF_GUARD', targetTable: 'staff_profile' },
  CANNOT_CHANGE_OWN_STATUS: {
    kind: 'SELF_GUARD',
    targetTable: 'staff_profile',
  },

  // M15 — a setting that may never move, or may no longer move.
  SETTING_IMMUTABLE: { kind: 'SETTING_LOCKED', targetTable: 'setting' },
  SETTING_LOCKED_BY_HISTORY: {
    kind: 'SETTING_LOCKED',
    targetTable: 'setting',
  },

  // M02 — an administration id that is missing or belongs elsewhere.
  STAFF_NOT_FOUND: { kind: 'OUT_OF_SCOPE', targetTable: 'staff_profile' },
  SETTING_NOT_FOUND: { kind: 'OUT_OF_SCOPE', targetTable: 'setting' },
};

/** The classification for a thrown error, or `null` if it is not recorded. */
export function classifyRefusal(error: unknown): {
  kind: SecurityEventKind;
  targetTable?: string;
  code: string;
  status: number;
} | null {
  if (!(error instanceof AppError)) return null;
  const entry = SECURITY_REFUSALS[error.code];
  if (!entry) return null;
  // A 5xx is an infrastructure failure, not a refusal (the CHECK rejects it).
  if (error.status < 400 || error.status > 499) return null;
  return { ...entry, code: error.code, status: error.status };
}
