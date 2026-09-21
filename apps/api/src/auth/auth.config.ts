import { prisma } from '@repo/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { loadConfig } from '../platform/config/config.js';
import { completePasswordChange, passwordChange } from './password-change.js';
import {
  completePasswordReset,
  passwordReset,
  RESET_LINK_MINUTES,
  sendPasswordReset,
} from './password-reset.js';
import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './session-policy.js';
import { signInAudit, writeSignInAudit } from './sign-in-audit.js';
import { createSignInHooks } from './sign-in-policy.js';

/**
 * Better Auth answers *who you are*. It never answers *what you may do* —
 * roles and line scoping live in `staff_profile` and M02's PolicyGuard
 * (authentication.md).
 *
 * This file is the one sanctioned place that imports the `@repo/db` singleton
 * directly: Better Auth's Prisma adapter takes a client instance, so there is
 * no DI seam to hand it. Everything else receives Prisma through DI so the
 * test harness can substitute a transaction-bound client.
 */
const config = loadConfig();
const webOrigin = config.WEB_ORIGIN;
const isProduction = config.NODE_ENV === 'production';

signInAudit.write = (attempt) => writeSignInAudit(prisma, attempt);
passwordChange.complete = (userId) => completePasswordChange(prisma, userId);
passwordReset.send = async (request) => {
  await sendPasswordReset(prisma, request);
};
passwordReset.complete = (userId) => completePasswordReset(prisma, userId);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  // Passed explicitly rather than left for Better Auth to read from the
  // environment: config.ts is the only reader of process.env (M16).
  secret: config.BETTER_AUTH_SECRET,

  // The origin the browser reaches Better Auth on. Same-origin in both
  // environments, so this is the web origin rather than the API port: in
  // development apps/web proxies /api/* to :3001. Without it Better Auth
  // derives the origin per-request, which makes callbacks and redirects
  // unreliable.
  baseURL: webOrigin,

  emailAndPassword: {
    enabled: true,
    // M01, security.md — staff accounts are Admin-created, never
    // self-registered. `/api/auth/sign-up/email` refuses every request; staff
    // creation (US-092) creates the user and credential server-side.
    disableSignUp: true,
    minPasswordLength: 10,

    // US-003 self-service reset, offered to all four roles (decided
    // 2026-09-20). Better Auth answers the same neutral message whether or not
    // the address exists; `sendPasswordReset` keeps it that way by queueing
    // nothing for a suspended, deleted or non-staff account.
    //
    // Rate limiting is Better Auth's own: it ships a rule of three requests a
    // minute for /request-password-reset, active when rate limiting is on —
    // which, left at the default, means production only, per process. The same
    // caveat as the sign-up limiter (M01).
    sendResetPassword: async ({ user, url }) => {
      await passwordReset.send({
        userId: user.id,
        name: user.name,
        url,
        emailEnabled: config.EMAIL_PROVIDER === 'SMTP',
      });
    },
    resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,

    // Every device is signed out, as an Admin reset does. The audit entry is
    // written by `onPasswordReset`, which runs first and so can still count
    // the sessions.
    onPasswordReset: async ({ user }) => {
      await passwordReset.complete(user.id);
    },
    revokeSessionsOnPasswordReset: true,
  },

  // US-001: only ACTIVE staff sign in, and every attempt is audited.
  hooks: createSignInHooks(prisma),

  // 7 days rolling with "Keep me signed in", 30 days absolute — the reasoning
  // and the limit's enforcement are in session-policy.ts. Suspension still
  // revokes at once, server-side (M02).
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // Only over HTTPS in production. Development is same-origin through the
      // Next.js /api proxy, so `lax` is correct there and `secure` would break
      // it over plain HTTP.
      secure: isProduction,
    },
  },

  // Same-origin in both environments: production behind one origin, and in
  // development apps/web proxies /api/* to :3001. That keeps the session
  // cookie first-party, which is what the offline service worker needs when
  // it replays queued requests (authentication.md).
  trustedOrigins: [webOrigin],
});
