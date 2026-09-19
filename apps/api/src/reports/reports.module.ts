import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module.js';
import { CollectionReportService } from './collection-report.service.js';
import { DiscrepancyReportService } from './discrepancy-report.service.js';
import { InvestmentReportService } from './investment-report.service.js';
import { LineWiseReportService } from './line-wise-report.service.js';
import { OverdueReportService } from './overdue-report.service.js';
import { ReportController } from './report.controller.js';

/**
 * M12 Reports. Owns no data and no store of its own: each report reads the
 * readers the dashboards share (`dashboards/business-figures.ts`,
 * `cash/line-day-figures.ts`) over a date range (`report-range.ts`), so a
 * report and a dashboard cannot disagree about the same day.
 */
@Module({
  // M15: the overdue report reads `account.overdueGraceDays` (BR-05, US-094).
  imports: [SettingsModule],
  controllers: [ReportController],
  providers: [
    LineWiseReportService,
    InvestmentReportService,
    CollectionReportService,
    OverdueReportService,
    DiscrepancyReportService,
  ],
})
export class ReportsModule {}
