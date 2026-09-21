import type { PrismaClient } from '@repo/db';

import { passwordResetEmail } from '../email/email-templates.js';
import { Database } from '../platform/database/database.js';

/**
 * US-003 self-service password reset — the half a staff member starts alone,
 * beside the Admin-initiated reset in `staff-password.service.ts`.
 *
 * Better Auth owns the token: `POST /api/auth/request-password-reset` writes a
 * one-time value into `verification` and calls `sendResetPassword` with the
 * link, and `POST /api/auth/reset-password` consumes it. This file is the two
 * Rasi-side halves of that — queueing the email, and recording what the reset
 * did to the staff profile.
 *
 * **Offered to all four roles** (decided 2026-09-20). Field staff often have a
 * placeholder address an Admin typed at onboarding; the link then simply never
 * arrives and they ask an Admin, exactly as before. The screen says the same
 * thing either way, so an unreachable inbox costs nothing and no one can probe
 * which addresses are real.
 *
 * Like `signInAudit` and `passwordChange`, it is an object with methods: Better
 * Auth's callbacks run outside Nest's injector, so `auth.config.ts` wires them
 * to the real writes and HTTP tests can substitute their own.
 */

/** How long the link lasts. The email prints this number. */
export const RESET_LINK_MINUTES = 30;

export interface PasswordResetRequest {
  userId: string;
  /** The staff member's name, for the greeting. */
  name: string;
  /** Better Auth's one-time link, token already in it. */
  url: string;
  /** `false` with `EMAIL_PROVIDER=NONE` — nothing is queued (M10). */
  emailEnabled: boolean;
}

export const passwordReset: {
  send: (request: PasswordResetRequest) => Promise<void>;
  complete: (userId: string) => Promise<void>;
} = {
  send: () => {
    throw new Error('passwordReset.send is not configured');
  },
  complete: () => {
    throw new Error('passwordReset.complete is not configured');
  },
};

/**
 * Queues the reset email. `true` when a row was written.
 *
 * Only an ACTIVE, undeleted staff member is sent a link. Anyone else — a
 * suspended account, a soft-deleted one, or a user with no staff profile — is
 * silently passed over: Better Auth has already answered the browser with the
 * same neutral message, so nothing here may make the two cases look different.
 *
 * The verification token is Better Auth's own, written before this callback, so
 * there is no wider transaction to join; `Database.transaction` is still used
 * rather than a bare create, so the write joins an enclosing Tier 1 rollback.
 */
export async function sendPasswordReset(
  client: PrismaClient,
  request: PasswordResetRequest,
): Promise<boolean> {
  const staff = await client.staffProfile.findFirst({
    where: { userId: request.userId, status: 'ACTIVE', deletedAt: null },
    select: { organizationId: true },
  });
  if (!staff || !request.emailEnabled) return false;

  const content = passwordResetEmail({
    name: request.name,
    resetUrl: request.url,
    validForMinutes: RESET_LINK_MINUTES,
  });

  await new Database(client).transaction(async (tx) => {
    await tx.emailOutbox.create({
      data: {
        organizationId: staff.organizationId,
        userId: request.userId,
        kind: 'PASSWORD_RESET',
        subject: content.subject,
        textBody: content.text,
        htmlBody: content.html,
        nextAttemptAt: new Date(),
      },
    });
  });
  return true;
}

/**
 * Records a completed reset (M13). Runs from Better Auth's `onPasswordReset`,
 * after the new password is stored and before `revokeSessionsOnPasswordReset`
 * deletes the sessions — which is why the count is taken here.
 *
 * A pending forced change is cleared: the staff member has just chosen a
 * password themselves, which is what `mustChangePassword` was waiting for.
 */
export async function completePasswordReset(
  client: PrismaClient,
  userId: string,
): Promise<void> {
  const staff = await client.staffProfile.findFirst({
    where: { userId },
    select: { id: true, organizationId: true, mustChangePassword: true },
  });
  if (!staff) return;

  const sessionsRevoked = await client.session.count({ where: { userId } });

  await new Database(client).transaction(async (tx) => {
    if (staff.mustChangePassword) {
      await tx.staffProfile.update({
        where: { id: staff.id },
        data: { mustChangePassword: false },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: staff.organizationId,
        actorUserId: userId,
        entityTable: 'staff_profile',
        entityId: staff.id,
        action: 'UPDATE',
        before: { mustChangePassword: staff.mustChangePassword },
        after: {
          mustChangePassword: false,
          passwordReset: 'SELF_SERVICE',
          sessionsRevoked,
        },
      },
    });
  });
}
