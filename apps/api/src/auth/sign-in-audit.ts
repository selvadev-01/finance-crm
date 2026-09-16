import type { PrismaClient } from '@repo/db';

/**
 * The `LOGIN` audit entry for every sign-in attempt (M13, US-001).
 *
 * Recorded: the outcome, a reason code, IP address and user agent, and the
 * user when the email matched one. **Never recorded:** the password, and the
 * email typed for an attempt that matched no user — a mistyped address is
 * personal data about someone else, and the audit log is readable by Admins.
 */
export type SignInOutcome = 'SUCCESS' | 'FAILURE' | 'REFUSED';

export interface SignInAttempt {
  /** The matched user, or `null` when the email matched nobody. */
  userId: string | null;
  outcome: SignInOutcome;
  /** A stable code: `INVALID_EMAIL_OR_PASSWORD`, `STAFF_NOT_ACTIVE`, … `null` on success. */
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Written as the entity id when the attempt matched no user. */
export const UNKNOWN_USER = 'unknown';

/**
 * Builds the `audit_log` row for an attempt. Separate from the write so the
 * row's shape is testable, and so tests can prove it satisfies the table.
 */
export function signInAuditRow(attempt: SignInAttempt, organizationId: string | null = null) {
  return {
    organizationId,
    actorUserId: attempt.userId,
    entityTable: 'user',
    entityId: attempt.userId ?? UNKNOWN_USER,
    action: 'LOGIN' as const,
    after: { outcome: attempt.outcome, reason: attempt.reason },
    ipAddress: attempt.ipAddress,
    userAgent: attempt.userAgent,
  };
}

export async function writeSignInAudit(
  client: Pick<PrismaClient, 'auditLog' | 'staffProfile'>,
  attempt: SignInAttempt,
): Promise<void> {
  // The organization of the staff member the email matched (US-090); none
  // for an unknown email, which stays outside every organization's log.
  const staff = attempt.userId
    ? await client.staffProfile.findUnique({ where: { userId: attempt.userId }, select: { organizationId: true } })
    : null;
  await client.auditLog.create({ data: signInAuditRow(attempt, staff?.organizationId ?? null) });
}

/**
 * Where sign-in attempts are recorded. `auth.config.ts` sets `write` to the
 * `audit_log` insert.
 *
 * It is an object with a method so HTTP tests can replace it
 * (`test/app.ts`): `audit_log` rejects DELETE, so a real row written by a
 * test could never be cleaned out of the shared development schema.
 */
export const signInAudit: {
  write: (attempt: SignInAttempt) => Promise<void>;
} = {
  write: () => {
    throw new Error('signInAudit.write is not configured');
  },
};
