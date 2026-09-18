import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { OverdueService } from './overdue.service.js';

/** M05 Accounts — creation, schedule and disbursement. */
@Module({
  // M15: the overdue job reads `account.overdueGraceDays` (BR-05, US-094).
  imports: [LedgerModule, SettingsModule],
  controllers: [AccountController],
  providers: [AccountService, OverdueService],
  exports: [AccountService, OverdueService],
})
export class AccountsModule {}
