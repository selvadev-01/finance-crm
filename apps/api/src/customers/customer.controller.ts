import { Controller } from '@nestjs/common';
import {
  customerContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { CustomerService } from './customer.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** M04 Customers. Scope is applied in the service (M02). */
@Controller()
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @RequirePermission('customer.view')
  @ContractRoute(api.listCustomers)
  listCustomers(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listCustomers'>,
  ): Out<'listCustomers'> {
    return this.customers.list(context, query);
  }

  /** References are included: `customer.viewReferences` has the same cells. */
  @RequirePermission('customer.view')
  @ContractRoute(api.getCustomer)
  getCustomer(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'getCustomer'>,
  ): Out<'getCustomer'> {
    return this.customers.get(context, params.customerId);
  }

  @RequirePermission('customer.create')
  @ContractRoute(api.createCustomer)
  createCustomer(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createCustomer'>,
  ): Out<'createCustomer'> {
    return this.customers.create(context, body);
  }
}
