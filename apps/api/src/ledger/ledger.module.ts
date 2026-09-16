import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service.js';
import { ReconciliationService } from './reconciliation.service.js';

/**
 * M09 Ledger. No controller: postings are system-only (M09 operations).
 * `ReconciliationService` is run by the nightly job (M14, US-095).
 */
@Module({
  providers: [LedgerService, ReconciliationService],
  exports: [LedgerService, ReconciliationService],
})
export class LedgerModule {}
