import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@thallesp/nestjs-better-auth';

import { auth } from './auth.config.js';

/**
 * The session check: a valid Better Auth session, or `401`. Not a global guard
 * itself — M02's `PolicyGuard` calls it after handling public routes.
 *
 * It wraps the library's `AuthGuard` rather than letting it run globally
 * because that guard resolves the session — a database query — *before*
 * checking whether a route is public, so `/health/live` would fail whenever
 * the database is down. `PolicyGuard` returns early for public routes, and
 * only then does this run. It attaches `request.session` and `request.user`.
 */
@Injectable()
export class RasiAuthGuard {
  private readonly sessionGuard: AuthGuard;

  constructor(reflector: Reflector) {
    this.sessionGuard = new AuthGuard(reflector, { auth });
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    return this.sessionGuard.canActivate(context);
  }
}
