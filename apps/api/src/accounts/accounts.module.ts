import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { OverdueService } from './overdue.service.js';

/** M05 Accounts — creation, schedule and disbursement. */
@Module({
  imports: [LedgerModule],
  controllers: [AccountController],
  providers: [AccountService, OverdueService],
  exports: [AccountService, OverdueService],
})
export class AccountsModule {}
