import { Module } from '@nestjs/common';

import { AccountSettlement } from '../collections/account-settlement.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { CashController } from './cash.controller.js';
import { DayCloseService } from './day-close.service.js';
import { DeviceSyncService } from './device-sync.service.js';
import { HandoverViews } from './handover-views.js';
import { HandoverService } from './handover.service.js';

/**
 * M08 Day close and cash control. Exports `DayCloseService` so a collection
 * or an approved correction on a closed date reopens it (BR-16a).
 * `AccountSettlement` is stateless and provided here too, for closing.
 */
@Module({
  imports: [LedgerModule],
  controllers: [CashController],
  providers: [
    AccountSettlement,
    DayCloseService,
    DeviceSyncService,
    HandoverService,
    HandoverViews,
  ],
  exports: [DayCloseService],
})
export class CashModule {}
