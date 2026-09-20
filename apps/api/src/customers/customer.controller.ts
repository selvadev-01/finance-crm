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
import { CustomerOverviewService } from './customer-overview.service.js';
import { CustomerService } from './customer.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** M04 Customers. Scope is applied in the service (M02). */
@Controller()
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly overview: CustomerOverviewService,
  ) {}

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

  @RequirePermission('customer.update')
  @ContractRoute(api.updateCustomer)
  updateCustomer(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'updateCustomer'>,
  ): Out<'updateCustomer'> {
    return this.customers.update(context, params.customerId, body);
  }

  /** US-022: the figures Customer 360 shows beside the accounts. */
  @RequirePermission('customer.view')
  @ContractRoute(api.getCustomerOverview)
  getCustomerOverview(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'getCustomerOverview'>,
  ): Out<'getCustomerOverview'> {
    return this.overview.get(context, params.customerId);
  }

  /** US-023. Past collections keep their line (BR-15); only the future moves. */
  @RequirePermission('customer.changeLine')
  @ContractRoute(api.transferCustomer)
  transferCustomer(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'transferCustomer'>,
  ): Out<'transferCustomer'> {
    return this.customers.transfer(context, params.customerId, body);
  }

  /** Visible wherever the customer is: it explains their collection history. */
  @RequirePermission('customer.view')
  @ContractRoute(api.listCustomerTransfers)
  listCustomerTransfers(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'listCustomerTransfers'>,
  ): Out<'listCustomerTransfers'> {
    return this.customers.transfers(context, params.customerId);
  }
}
