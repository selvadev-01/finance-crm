import { AuthModule } from '@thallesp/nestjs-better-auth';

import { auth } from './auth.config.js';

/**
 * Better Auth mounted into Nest, serving `/api/auth/*`.
 *
 * The object form `forRoot({ auth })` is required — `forRoot(auth)` is the
 * deprecated v1 signature and does not work here (authentication.md).
 *
 * There is deliberately no `app/api/auth/[...all]/route.ts` in apps/web: the
 * API owns authentication so packages/db stays the sole holder of a Prisma
 * client, and so the offline outbox can replay with a plain cookie rather than
 * carrying a bearer token.
 */
export const RasiAuthModule = AuthModule.forRoot({ auth });
