import { Module } from '@nestjs/common';

import { CashModule } from '../cash/cash.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AccountSettlement } from './account-settlement.js';
import { CollectionController } from './collection.controller.js';
import { CollectionHistoryService } from './collection-history.service.js';
import { CollectionService } from './collection.service.js';
import { CorrectionService } from './correction.service.js';
import { IdempotencyPurgeService } from './idempotency-purge.service.js';
import { RouteService } from './route.service.js';

/** M07 Collections — the route, recording, replay safety. */
@Module({
  imports: [LedgerModule, CashModule],
  controllers: [CollectionController],
  providers: [
    AccountSettlement,
    CollectionHistoryService,
    CollectionService,
    CorrectionService,
    IdempotencyPurgeService,
    RouteService,
  ],
  exports: [IdempotencyPurgeService],
})
export class CollectionsModule {}
