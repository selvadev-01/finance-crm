import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service.js';

/** M09 Ledger. No controller: postings are system-only (M09 operations). */
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
