import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { CollectionController } from './collection.controller.js';
import { CollectionService } from './collection.service.js';
import { RouteService } from './route.service.js';

/** M07 Collections — the route, recording, replay safety. */
@Module({
  imports: [LedgerModule],
  controllers: [CollectionController],
  providers: [CollectionService, RouteService],
})
export class CollectionsModule {}
