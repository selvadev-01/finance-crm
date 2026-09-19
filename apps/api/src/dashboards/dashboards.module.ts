import { Module } from '@nestjs/common';

import { CashModule } from '../cash/cash.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BusinessOverviewService } from './business-overview.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardTrendService } from './dashboard-trend.service.js';
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
  // M15: the line dashboard reads `account.overdueGraceDays` (BR-05, US-094).
  imports: [CashModule, SettingsModule],
  controllers: [DashboardController],
  providers: [
    BusinessOverviewService,
    DashboardTrendService,
    LineDashboardService,
    OperationsDashboardService,
    SectorComparisonService,
  ],
})
export class DashboardsModule {}
