import { Module } from '@nestjs/common';

import { CollectionReportService } from './collection-report.service.js';
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
  controllers: [ReportController],
  providers: [
    LineWiseReportService,
    InvestmentReportService,
    CollectionReportService,
    OverdueReportService,
  ],
})
export class ReportsModule {}
