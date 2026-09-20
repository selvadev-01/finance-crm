import { Controller } from '@nestjs/common';
import {
  accountContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { AccountService } from './account.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** M05 Accounts. Scope and money visibility are applied in the service (M02). */
@Controller()
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  /** Declared before `:accountId` routes so `preview` is never read as an id. */
  @RequirePermission('account.create')
  @ContractRoute(api.previewAccount)
  previewAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'previewAccount'>,
  ): Out<'previewAccount'> {
    return this.accounts.preview(context, body);
  }

  @RequirePermission('account.create')
  @ContractRoute(api.createAccount)
  createAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createAccount'>,
  ): Out<'createAccount'> {
    return this.accounts.create(context, body);
  }

  @RequirePermission('account.disburse')
  @ContractRoute(api.disburseAccount)
  disburseAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'disburseAccount'>,
  ): Out<'disburseAccount'> {
    return this.accounts.disburse(context, params.accountId);
  }

  /** US-035 — Super Admin only; a write-off destroys receivable value (M05). */
  @RequirePermission('account.close')
  @ContractRoute(api.closeAccount)
  closeAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'closeAccount'>,
  ): Out<'closeAccount'> {
    return this.accounts.close(context, params.accountId, body);
  }

  @RequirePermission('account.view')
  @ContractRoute(api.listAccounts)
  listAccounts(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listAccounts'>,
  ): Out<'listAccounts'> {
    return this.accounts.list(context, query);
  }

  @RequirePermission('account.view')
  @ContractRoute(api.getAccount)
  getAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'getAccount'>,
  ): Out<'getAccount'> {
    return this.accounts.get(context, params.accountId);
  }

  @RequirePermission('account.viewSchedule')
  @ContractRoute(api.getAccountSchedule)
  getAccountSchedule(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'getAccountSchedule'>,
  ): Out<'getAccountSchedule'> {
    return this.accounts.schedule(context, params.accountId);
  }
}
