import { Module } from '@nestjs/common';

import { ExportsModule } from '../exports/exports.module.js';
import { LedgerTransactionsService } from './ledger-transactions.service.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { StatementsController } from './statements.controller.js';
import { StatementsService } from './statements.service.js';
import { TrialBalanceService } from './trial-balance.service.js';

/**
 * M09 Ledger. The controllers only read — the trial balance, the
 * transactions and the statements (ADR-0018), with their exports; postings
 * stay with the modules whose events they record. `ReconciliationService` is
 * run by the nightly job (M14, US-095).
 */
@Module({
  imports: [ExportsModule],
  controllers: [LedgerController, StatementsController],
  providers: [
    LedgerService,
    LedgerTransactionsService,
    ReconciliationService,
    StatementsService,
    TrialBalanceService,
  ],
  exports: [LedgerService, ReconciliationService],
})
export class LedgerModule {}
