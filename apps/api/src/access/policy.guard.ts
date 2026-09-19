import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { RasiAuthGuard } from '../auth/rasi-auth.guard.js';
import {
  getRequestId,
  setRequestContext,
  setRequestRoute,
} from '../platform/context/request-context.js';
import {
  AuthenticationError,
  AuthorizationError,
} from '../platform/errors/errors.js';
import { SecurityEventRecorder } from '../security/security-event.recorder.js';
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
    private readonly security: SecurityEventRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string } | null;
      method?: string;
      params?: Record<string, string>;
    }>();
    // Recorded before anything can be refused, so a service that turns an
    // attempt away deep inside a call can still name the route (M13).
    setRequestRoute({
      method: request.method ?? 'GET',
      path: routePath(context),
    });

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, targets)) {
      return true;
    }

    await this.authGuard.canActivate(context);
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
      const denied = new AuthorizationError(
        'PERMISSION_DENIED',
        'Your role cannot perform this action',
      );
      // A durable record of the attempt, not only a log line that ages out
      // (M13, ADR-0014). The permission is the fact worth keeping — it says
      // what was reached for; the request body is never recorded.
      await this.security.refused(requestContext, denied, {
        id: firstParam(request.params),
        detail: { permission },
      });
      throw denied;
    }
    return true;
  }
}

/**
 * The route's pattern, `/api/staff/:staffProfileId/role`, built the same way
 * `RouteAccessAudit` builds it — so a recorded path can be matched against the
 * route catalogue and the RBAC matrix.
 */
function routePath(context: ExecutionContext): string {
  const controller = String(
    Reflect.getMetadata(PATH_METADATA, context.getClass()) ?? '',
  );
  const handler = String(
    Reflect.getMetadata(PATH_METADATA, context.getHandler()) ?? '',
  );
  const joined = [controller, handler]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

/** The row the request named, where the route takes exactly one. */
function firstParam(params: Record<string, string> | undefined): string | null {
  const values = Object.values(params ?? {});
  return values.length === 1 ? (values[0] ?? null) : null;
}
