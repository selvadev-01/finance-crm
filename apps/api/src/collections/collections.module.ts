import { Module } from '@nestjs/common';

import { CashModule } from '../cash/cash.module.js';
import { ExportsModule } from '../exports/exports.module.js';
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
  // M12 export: the collection list (S-16) as Excel and PDF.
  imports: [LedgerModule, CashModule, ExportsModule],
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
