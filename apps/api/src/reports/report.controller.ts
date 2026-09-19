import { Controller, StreamableFile } from '@nestjs/common';
import {
  reportContract as api,
  exportContract as download,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import {
  EXPORT_PAGE_SIZE,
  ExportService,
  readAllPages,
} from '../exports/export.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { CollectionReportService } from './collection-report.service.js';
import { DiscrepancyReportService } from './discrepancy-report.service.js';
import { InvestmentReportService } from './investment-report.service.js';
import { LineWiseReportService } from './line-wise-report.service.js';
import { OverdueReportService } from './overdue-report.service.js';
import {
  collectionReportDocument,
  discrepancyDocument,
  investmentDocument,
  lineWiseDocument,
  overdueDocument,
} from './report-exports.js';

/**
 * M12 Reports. Viewing is read-only and unaudited; an export writes an
 * `EXPORT` audit entry (M13) and nothing else. Every report is guarded
 * by `report.view` — Super Admin, Admin, and a Senior for their own line
 * (rbac-matrix.md#money-visibility-m09-m11-m12); which rows is scope's
 * decision, in the service.
 */
@Controller()
export class ReportController {
  constructor(
    private readonly lineWise: LineWiseReportService,
    private readonly investment: InvestmentReportService,
    private readonly collections: CollectionReportService,
    private readonly overdue: OverdueReportService,
    private readonly discrepancies: DiscrepancyReportService,
    private readonly exporter: ExportService,
  ) {}

  /** US-084, PDF §14. */
  @RequirePermission('report.view')
  @ContractRoute(api.getLineWise)
  getLineWise(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getLineWise>,
  ): Promise<RouteSuccess<typeof api.getLineWise>> {
    return this.lineWise.view(context, query);
  }

  /** US-085, PDF §22. */
  @RequirePermission('report.view')
  @ContractRoute(api.getInvestment)
  getInvestment(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getInvestment>,
  ): Promise<RouteSuccess<typeof api.getInvestment>> {
    return this.investment.view(context, query);
  }

  /** US-086, BR-08 and BR-16 over a date range. */
  @RequirePermission('report.view')
  @ContractRoute(api.getCollection)
  getCollection(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getCollection>,
  ): Promise<RouteSuccess<typeof api.getCollection>> {
    return this.collections.view(context, query);
  }

  /** US-087, BR-05 — the accounts past their target completion date. */
  @RequirePermission('report.view')
  @ContractRoute(api.getOverdue)
  getOverdue(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getOverdue>,
  ): Promise<RouteSuccess<typeof api.getOverdue>> {
    return this.overdue.view(context, query);
  }

  /** The discrepancy report, BR-17 — cash counted against cash recorded. */
  @RequirePermission('report.view')
  @ContractRoute(api.getDiscrepancy)
  getDiscrepancy(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getDiscrepancy>,
  ): Promise<RouteSuccess<typeof api.getDiscrepancy>> {
    return this.discrepancies.view(context, query);
  }

  // ---------------------------------------------------------------- Export
  //
  // Each export reads its report through the same service call as the screen,
  // under the same permission, then hands the document to `ExportService`,
  // which renders the file and records the EXPORT in the audit log (M12, M13).

  @RequirePermission('report.view')
  @ContractRoute(download.lineWiseReport)
  async exportLineWise(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    {
      query: { format, ...filters },
    }: RouteInput<typeof download.lineWiseReport>,
  ): Promise<StreamableFile> {
    const report = await this.lineWise.view(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'reports/line-wise', format, filters },
      lineWiseDocument(report, filters),
    );
  }

  @RequirePermission('report.view')
  @ContractRoute(download.investmentReport)
  async exportInvestment(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    {
      query: { format, ...filters },
    }: RouteInput<typeof download.investmentReport>,
  ): Promise<StreamableFile> {
    const report = await this.investment.view(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'reports/investment', format, filters },
      investmentDocument(report, filters),
    );
  }

  @RequirePermission('report.view')
  @ContractRoute(download.collectionReport)
  async exportCollection(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    {
      query: { format, ...filters },
    }: RouteInput<typeof download.collectionReport>,
  ): Promise<StreamableFile> {
    const report = await this.collections.view(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'reports/collection', format, filters },
      collectionReportDocument(report, filters),
    );
  }

  @RequirePermission('report.view')
  @ContractRoute(download.overdueReport)
  async exportOverdue(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    {
      query: { format, ...filters },
    }: RouteInput<typeof download.overdueReport>,
  ): Promise<StreamableFile> {
    const { first, rows } = await readAllPages((cursor) =>
      this.overdue.view(context, {
        ...filters,
        cursor,
        limit: EXPORT_PAGE_SIZE,
      }),
    );
    return this.exporter.deliver(
      context,
      { name: 'reports/overdue', format, filters },
      overdueDocument(first, rows, filters),
    );
  }

  @RequirePermission('report.view')
  @ContractRoute(download.discrepancyReport)
  async exportDiscrepancy(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    {
      query: { format, ...filters },
    }: RouteInput<typeof download.discrepancyReport>,
  ): Promise<StreamableFile> {
    const { first, rows } = await readAllPages((cursor) =>
      this.discrepancies.view(context, {
        ...filters,
        cursor,
        limit: EXPORT_PAGE_SIZE,
      }),
    );
    return this.exporter.deliver(
      context,
      { name: 'reports/discrepancy', format, filters },
      discrepancyDocument(first, rows, filters),
    );
  }
}
