import { Module } from '@nestjs/common';

import { CashModule } from '../cash/cash.module.js';
import { BusinessOverviewService } from './business-overview.service.js';
import { DashboardController } from './dashboard.controller.js';
import { LineDashboardService } from './line-dashboard.service.js';
import { OperationsDashboardService } from './operations-dashboard.service.js';
import { SectorComparisonService } from './sector-comparison.service.js';

/**
 * M11 Dashboards. Owns queries, not data: every figure is read from the
 * modules that own it — the Super Admin business overview (US-080), the
 * sector comparison (US-081) and the Admin operational dashboard (US-082),
 * which share `business-figures.ts`, and the Senior line dashboard (US-083),
 * which reads the day close's own view.
 */
@Module({
  imports: [CashModule],
  controllers: [DashboardController],
  providers: [
    BusinessOverviewService,
    LineDashboardService,
    OperationsDashboardService,
    SectorComparisonService,
  ],
})
export class DashboardsModule {}
