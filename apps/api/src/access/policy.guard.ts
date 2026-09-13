import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { RasiAuthGuard } from '../auth/rasi-auth.guard.js';
import {
  getRequestId,
  setRequestContext,
} from '../platform/context/request-context.js';
import {
  AuthenticationError,
  AuthorizationError,
} from '../platform/errors/errors.js';
import { PERMISSION_METADATA } from './decorators.js';
import { type Permission, roleHasPermission } from './permissions.js';
import { RequestContextResolver } from './request-context.resolver.js';

/** The metadata key `@AllowAnonymous()` sets. */
const PUBLIC_METADATA = 'PUBLIC';

/**
 * The single global guard (M02). Every request goes through these steps, in
 * this order, and each failure has a fixed status:
 *
 * 1. `@AllowAnonymous()` → allowed, nothing resolved.
 * 2. **Session** — no valid Better Auth session → `401 UNAUTHENTICATED`.
 * 3. **Route declares a permission** — missing → `403 ROUTE_PERMISSION_MISSING`.
 *    Fails closed; `RouteAccessAudit` also stops such an app from starting.
 * 4. **Staff** — no `ACTIVE`, undeleted staff profile → `401 STAFF_NOT_ACTIVE`.
 *    Checked on every request, so a suspension is immediate (M01).
 * 5. **Action** — role lacks the permission → `403 PERMISSION_DENIED`.
 *
 * The *row* check is not here: it happens in repositories, where an
 * out-of-scope row is indistinguishable from a missing one (`404`).
 *
 * Authentication is delegated to `RasiAuthGuard` inside this guard rather than
 * registered as a second global guard, because the order of multiple global
 * guards depends on module import order — too fragile for access control.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authGuard: RasiAuthGuard,
    private readonly resolver: RequestContextResolver,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, targets)) {
      return true;
    }

    await this.authGuard.canActivate(context);
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string } | null }>();
    const userId = request.user?.id;
    if (!userId) {
      throw new AuthenticationError('UNAUTHENTICATED', 'Sign in to continue');
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_METADATA,
      targets,
    );
    if (!permission) {
      throw new AuthorizationError(
        'ROUTE_PERMISSION_MISSING',
        'This route does not declare a permission',
      );
    }

    const caller = await this.resolver.resolveCaller(
      userId,
      getRequestId() ?? 'unavailable',
    );
    if (!caller) {
      // Deliberately the same message whatever the reason — suspended,
      // inactive, deleted, or never a staff member (US-001).
      throw new AuthenticationError(
        'STAFF_NOT_ACTIVE',
        'This account cannot use Rasi. Contact an administrator.',
      );
    }
    const requestContext = caller.context;
    setRequestContext(requestContext);
    this.logger.assign({ userId });

    // US-003: after an Admin reset, the temporary password buys exactly one
    // thing — Better Auth's /api/auth/change-password, which is not guarded
    // here. Every Rasi route waits until it has been used.
    if (caller.mustChangePassword) {
      throw new AuthorizationError(
        'PASSWORD_CHANGE_REQUIRED',
        'Set a new password before continuing',
      );
    }

    if (!roleHasPermission(requestContext.role, permission)) {
      throw new AuthorizationError(
        'PERMISSION_DENIED',
        'Your role cannot perform this action',
      );
    }
    return true;
  }
}
