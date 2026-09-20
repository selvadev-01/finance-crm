import { Module } from '@nestjs/common';

import { CustomerController } from './customer.controller.js';
import { CustomerOverviewService } from './customer-overview.service.js';
import { CustomerService } from './customer.service.js';

/** M04 Customers — onboarding and the customer record. */
@Module({
  controllers: [CustomerController],
  providers: [CustomerService, CustomerOverviewService],
  exports: [CustomerService, CustomerOverviewService],
})
export class CustomersModule {}
