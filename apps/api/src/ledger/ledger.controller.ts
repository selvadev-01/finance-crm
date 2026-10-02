import { Controller } from '@nestjs/common';
import {
  ledgerContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { LedgerTransactionsService } from './ledger-transactions.service.js';
import { TrialBalanceService } from './trial-balance.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** M09 reads. Nothing here posts: postings stay system-only (M09 operations). */
@Controller()
export class LedgerController {
  constructor(
    private readonly trialBalance: TrialBalanceService,
    private readonly transactions: LedgerTransactionsService,
  ) {}

  @RequirePermission('ledger.view')
  @ContractRoute(api.getTrialBalance)
  getTrialBalance(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'getTrialBalance'>,
  ): Out<'getTrialBalance'> {
    return this.trialBalance.trialBalance(context, query);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.listTransactions)
  listTransactions(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listTransactions'>,
  ): Out<'listTransactions'> {
    return this.transactions.list(context, query);
  }
}
