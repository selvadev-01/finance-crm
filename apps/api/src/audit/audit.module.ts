import { Global, Module } from '@nestjs/common';

import { AuditWriter } from './audit.writer.js';

/**
 * M13 Audit. Global: every module that changes audited data records through
 * `AuditWriter`, inside its own transaction.
 */
@Global()
@Module({
  providers: [AuditWriter],
  exports: [AuditWriter],
})
export class AuditModule {}
