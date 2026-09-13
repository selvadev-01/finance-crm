import { getIP } from '@better-auth/core/utils/ip';
import type { PrismaClient } from '@repo/db';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';

import { passwordChange } from './password-change.js';
import { type SignInAttempt, signInAudit } from './sign-in-audit.js';

export const CHANGE_PASSWORD_PATH = '/change-password';

/**
 * Sign-in policy (M01, US-001), as Better Auth hooks.
 *
 * **Only `ACTIVE`, undeleted staff may sign in.** The status check runs in the
 * `before` hook — ahead of password verification — so the refusal is the same
 * whether or not the password was right, and reveals nothing about it. The
 * message is distinct from a wrong password on purpose (decided 2026-09-13):
 * a suspended Junior should call their Senior, not keep retrying passwords.
 *
 * Every attempt writes a `LOGIN` audit entry (M13). A successful sign-in whose
 * audit write fails is undone — its session deleted and the request failed —
 * because an audited action that commits without its entry is unaudited.
 */
export const SIGN_IN_PATH = '/sign-in/email';

export const STAFF_NOT_ACTIVE_MESSAGE =
  'This account cannot sign in. Contact your administrator.';

type Client = Pick<PrismaClient, 'user'>;

/**
 * `null` when no user has this email. Otherwise whether that user may sign in:
 * a staff profile that is `ACTIVE` and not soft-deleted.
 */
async function findSignInCandidate(client: Client, email: string) {
  const user = await client.user.findFirst({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      staffProfile: { select: { status: true, deletedAt: true } },
    },
  });
  if (!user) return null;
  const staff = user.staffProfile;
  return {
    userId: user.id,
    mayUseRasi: staff?.status === 'ACTIVE' && staff.deletedAt === null,
  };
}

function requestDetails(
  headers: Headers | undefined,
  options: BetterAuthOptions,
): Pick<SignInAttempt, 'ipAddress' | 'userAgent'> {
  if (!headers) return { ipAddress: null, userAgent: null };
  // The same derivation Better Auth uses for session.ipAddress.
  return {
    ipAddress: getIP(headers, options) || null,
    userAgent: headers.get('user-agent'),
  };
}

export function createSignInHooks(client: Client) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== 'string') return;

      const candidate = await findSignInCandidate(client, email);
      // An unknown email continues to Better Auth, which answers exactly as
      // for a wrong password; the after hook records it.
      if (!candidate || candidate.mayUseRasi) return;

      await signInAudit.write({
        userId: candidate.userId,
        outcome: 'REFUSED',
        reason: 'STAFF_NOT_ACTIVE',
        ...requestDetails(ctx.headers, ctx.context.options),
      });
      throw new APIError('FORBIDDEN', {
        code: 'STAFF_NOT_ACTIVE',
        message: STAFF_NOT_ACTIVE_MESSAGE,
      });
    }),

    after: createAuthMiddleware(async (ctx) => {
      // US-003: a successful password change ends a forced change.
      if (ctx.path === CHANGE_PASSWORD_PATH) {
        const userId = ctx.context.session?.user.id;
        if (userId && !isAPIError(ctx.context.returned)) {
          await passwordChange.complete(userId);
        }
        return;
      }
      if (ctx.path !== SIGN_IN_PATH) return;
      const details = requestDetails(ctx.headers, ctx.context.options);
      const returned = ctx.context.returned;

      if (isAPIError(returned)) {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        const candidate =
          typeof email === 'string'
            ? await findSignInCandidate(client, email)
            : null;
        const code = (returned.body as { code?: unknown } | undefined)?.code;
        await signInAudit.write({
          userId: candidate?.userId ?? null,
          outcome: 'FAILURE',
          reason: typeof code === 'string' ? code : 'SIGN_IN_FAILED',
          ...details,
        });
        return;
      }

      const created = ctx.context.newSession;
      if (!created) return;
      try {
        await signInAudit.write({
          userId: created.user.id,
          outcome: 'SUCCESS',
          reason: null,
          ...details,
        });
      } catch (error) {
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        ctx.context.logger.error(
          'Sign-in audit write failed; session revoked',
          error,
        );
        throw new APIError('INTERNAL_SERVER_ERROR', {
          code: 'SIGN_IN_AUDIT_FAILED',
          message: 'Sign-in could not be completed. Try again.',
        });
      }
    }),
  };
}
