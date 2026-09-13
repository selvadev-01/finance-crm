import { Module } from '@nestjs/common';

import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';

/** M04 Customers — onboarding and the customer record. */
@Module({
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomersModule {}
