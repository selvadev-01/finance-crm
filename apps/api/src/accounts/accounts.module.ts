import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

/** M05 Accounts — creation, schedule and disbursement. */
@Module({
  imports: [LedgerModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountsModule {}
