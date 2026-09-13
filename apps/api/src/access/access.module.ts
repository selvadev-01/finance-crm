import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';

import { RasiAuthModule } from '../auth/auth.module.js';
import { PolicyGuard } from './policy.guard.js';
import { RequestContextResolver } from './request-context.resolver.js';
import { RouteAccessAudit } from './route-access.audit.js';

/**
 * M02 Access Control — the global `PolicyGuard`, the request context resolver,
 * and the start-up audit of route declarations. Scope predicates live in
 * `scope.ts` and are imported by the repositories that apply them.
 */
@Module({
  imports: [RasiAuthModule, DiscoveryModule],
  providers: [
    RequestContextResolver,
    RouteAccessAudit,
    { provide: APP_GUARD, useClass: PolicyGuard },
  ],
})
export class AccessModule {}
