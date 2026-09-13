import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

import { getRequestContext } from '../platform/context/request-context.js';
import { InternalError } from '../platform/errors/errors.js';
import type { Permission } from './permissions.js';

export const PERMISSION_METADATA = 'rasi:permission';

/**
 * The permission a route requires (M02). Every route carries either this or
 * `@AllowAnonymous()`; a route with neither is refused at runtime, and the
 * application refuses to start (`RouteAccessAudit`).
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA, permission);

/**
 * The authorized `RequestContext`, for passing explicitly into repository
 * methods. Only valid on a `@RequirePermission` route — on a public route
 * there is no caller to describe, and asking for one is a programming error.
 */
export const CurrentContext = createParamDecorator(
  (_data: unknown, _host: ExecutionContext) => {
    const context = getRequestContext();
    if (!context) {
      throw new InternalError(
        'REQUEST_CONTEXT_UNAVAILABLE',
        '@CurrentContext() used on a route without @RequirePermission',
      );
    }
    return context;
  },
);
