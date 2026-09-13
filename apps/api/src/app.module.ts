import { Module } from '@nestjs/common';
import { RasiAuthModule } from './auth/auth.module.js';

/**
 * The application root.
 *
 * The create-nest-app scaffold (AppController / AppService and its "Hello
 * World!" tests) has been removed — it was placeholder, not foundation.
 *
 * Modules arrive here one directory per M01–M16 as they are built. The health
 * and readiness endpoints belong to M16 (Phase 1); until then the only routes
 * served are Better Auth's `/api/auth/*`.
 */
@Module({
  imports: [RasiAuthModule],
})
export class AppModule {}
