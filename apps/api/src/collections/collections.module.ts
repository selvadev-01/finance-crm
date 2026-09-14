import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { AccountSettlement } from './account-settlement.js';
import { CollectionController } from './collection.controller.js';
import { CollectionHistoryService } from './collection-history.service.js';
import { CollectionService } from './collection.service.js';
import { CorrectionService } from './correction.service.js';
import { RouteService } from './route.service.js';

/** M07 Collections — the route, recording, replay safety. */
@Module({
  imports: [LedgerModule],
  controllers: [CollectionController],
  providers: [
    AccountSettlement,
    CollectionHistoryService,
    CollectionService,
    CorrectionService,
    RouteService,
  ],
})
export class CollectionsModule {}
