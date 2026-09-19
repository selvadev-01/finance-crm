import { Global, Module } from '@nestjs/common';

import { SecurityController } from './security.controller.js';
import { SecurityEventRecorder } from './security-event.recorder.js';
import { SecurityEventsService } from './security-events.service.js';

/**
 * M13 Security log — the refusals (ADR-0014). Global, like `AuditModule`:
 * `PolicyGuard` and every service that turns an attempt away records through
 * `SecurityEventRecorder`, and a module-by-module import list would be one more
 * thing to remember. It also serves the read side.
 */
@Global()
@Module({
  controllers: [SecurityController],
  providers: [SecurityEventRecorder, SecurityEventsService],
  exports: [SecurityEventRecorder],
})
export class SecurityModule {}
