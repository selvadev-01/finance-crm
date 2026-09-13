import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';

import { auth } from './auth.config.js';
import { RasiAuthGuard } from './rasi-auth.guard.js';

/**
 * Better Auth mounted into Nest, serving `/api/auth/*`.
 *
 * The object form `forRoot({ auth })` is required — `forRoot(auth)` is the
 * deprecated v1 signature and does not work here (authentication.md).
 *
 * The library's global guard is disabled. Authentication runs inside M02's
 * `PolicyGuard`, through `RasiAuthGuard`, so that session, staff status,
 * permission and scope are checked in one fixed order.
 *
 * There is deliberately no `app/api/auth/[...all]/route.ts` in apps/web: the
 * API owns authentication so packages/db stays the sole holder of a Prisma
 * client, and so the offline outbox can replay with a plain cookie rather than
 * carrying a bearer token.
 */
@Module({
  imports: [AuthModule.forRoot({ auth, disableGlobalAuthGuard: true })],
  providers: [RasiAuthGuard],
  exports: [RasiAuthGuard],
})
export class RasiAuthModule {}
