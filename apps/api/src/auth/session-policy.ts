import { deleteSessionCookie } from 'better-auth/cookies';
import type { GenericEndpointContext } from 'better-auth';

const DAY_SECONDS = 60 * 60 * 24;

/**
 * Session lifetimes (M01, authentication.md#session-duration).
 *
 * With "Keep me signed in" — the sign-in form's `rememberMe`, on by default —
 * a session lasts 7 days and each day of use moves expiry out again, so a
 * Junior who is online at least once a week is not stopped at the door by a
 * sign-in that needs connectivity. Without it, Better Auth issues a
 * browser-session cookie and a 1-day session that never renews.
 */
export const SESSION_EXPIRES_IN_SECONDS = 7 * DAY_SECONDS;
export const SESSION_UPDATE_AGE_SECONDS = DAY_SECONDS;

/**
 * The absolute limit: however often it is renewed, a session ends 30 days
 * after sign-in. NIST SP 800-63B requires an overall timeout for
 * password-only sign-in (no more than 30 days); OWASP's absolute timeout. It
 * bounds how long a stolen cookie works, which rolling renewal alone does not.
 */
export const SESSION_ABSOLUTE_LIMIT_SECONDS = 30 * DAY_SECONDS;

export const GET_SESSION_PATH = '/get-session';

/** Whether a session created at `createdAt` has passed the absolute limit. */
export function isPastAbsoluteLimit(
  createdAt: Date | string,
  now: Date = new Date(),
): boolean {
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  return ageMs >= SESSION_ABSOLUTE_LIMIT_SECONDS * 1000;
}

interface ResolvedSession {
  session: { token: string; createdAt: Date | string };
}

function isResolvedSession(value: unknown): value is ResolvedSession {
  const session = (value as { session?: unknown } | null)?.session as
    { token?: unknown; createdAt?: unknown } | undefined;
  return (
    typeof session?.token === 'string' &&
    (session.createdAt instanceof Date || typeof session.createdAt === 'string')
  );
}

/**
 * Runs after every `/get-session` — the browser's call and the server-side one
 * `RasiAuthGuard` makes for each guarded request — so it is the one place the
 * absolute limit is enforced. A session past it is deleted, its cookies
 * expired, and the caller answered as though there were no session at all.
 *
 * Returns the replacement response, or `undefined` to leave it untouched.
 */
export async function enforceAbsoluteLimit(
  ctx: GenericEndpointContext,
  returned: unknown,
) {
  if (!isResolvedSession(returned)) return undefined;
  if (!isPastAbsoluteLimit(returned.session.createdAt)) return undefined;

  await ctx.context.internalAdapter.deleteSession(returned.session.token);
  deleteSessionCookie(ctx);
  return ctx.json(null);
}
