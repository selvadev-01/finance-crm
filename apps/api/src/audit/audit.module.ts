import { Global, Module } from '@nestjs/common';

import { AccountHistoryService } from './account-history.service.js';
import { AuditController } from './audit.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditWriter } from './audit.writer.js';

/**
 * M13 Audit. Global: every module that changes audited data records through
 * `AuditWriter`, inside its own transaction. It also serves the read side:
 * the audit log (US-090) and an account's history (US-091).
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditWriter, AuditLogService, AccountHistoryService],
  exports: [AuditWriter],
})
export class AuditModule {}
