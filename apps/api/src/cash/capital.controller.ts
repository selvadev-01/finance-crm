import { Controller } from '@nestjs/common';
import {
  capitalContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { CapitalService } from './capital.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** US-032 capital endpoints. Scope is applied inside the service (M02). */
@Controller()
export class CapitalController {
  constructor(private readonly capital: CapitalService) {}

  @RequirePermission('ledger.view')
  @ContractRoute(api.listCapital)
  listCapital(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listCapital'>,
  ): Out<'listCapital'> {
    return this.capital.list(context, query);
  }

  @RequirePermission('capital.add')
  @ContractRoute(api.addCapital)
  addCapital(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'addCapital'>,
  ): Out<'addCapital'> {
    return this.capital.add(context, body);
  }
}
