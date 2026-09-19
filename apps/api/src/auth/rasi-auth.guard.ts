import { type ExecutionContext, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';

import { auth } from './auth.config.js';

type SessionRequest = Request & {
  session?: unknown;
  user?: { id?: string } | null;
};

/**
 * The session check. Not a global guard itself — M02's `PolicyGuard` calls it
 * after handling public routes, and refuses with `401` when it attaches no
 * user.
 *
 * It resolves the session itself rather than through the library's
 * `AuthGuard`, for two reasons:
 *
 * - That guard resolves the session — a database query — *before* checking
 *   whether a route is public, so `/health/live` would fail whenever the
 *   database is down.
 * - It discards the response headers of `getSession`. Rolling renewal happens
 *   in that call: Better Auth moves the session's expiry out and re-issues the
 *   cookie with a fresh `Max-Age`. Dropped, the database session renews but
 *   the browser's cookie still expires 7 days after sign-in, and a staff
 *   member working every day is signed out anyway. The web app never calls
 *   `/api/auth/get-session` itself, so this is the only place renewal can
 *   reach the browser. The same headers carry the expired cookies when the
 *   session is past its absolute limit (session-policy.ts).
 *
 * It attaches `request.session` and `request.user`, as the library does.
 */
@Injectable()
export class RasiAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionRequest>();
    const response = http.getResponse<Response>();

    const { headers, response: session } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) {
      response.append('Set-Cookie', cookie);
    }

    request.session = session;
    request.user = session?.user ?? null;
    return true;
  }
}
