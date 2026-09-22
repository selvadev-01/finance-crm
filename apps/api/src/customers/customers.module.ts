import { Module } from '@nestjs/common';

import { CustomerController } from './customer.controller.js';
import { CustomerOverviewService } from './customer-overview.service.js';
import { CustomerService } from './customer.service.js';
import { LinePortfolioService } from './line-portfolio.service.js';

/** M04 Customers — onboarding, the customer record and the portfolio. */
@Module({
  controllers: [CustomerController],
  providers: [CustomerService, CustomerOverviewService, LinePortfolioService],
  exports: [CustomerService, CustomerOverviewService],
})
export class CustomersModule {}
