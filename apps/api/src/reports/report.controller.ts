import { Controller } from '@nestjs/common';
import {
  reportContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { CollectionReportService } from './collection-report.service.js';
import { InvestmentReportService } from './investment-report.service.js';
import { LineWiseReportService } from './line-wise-report.service.js';
import { OverdueReportService } from './overdue-report.service.js';

/**
 * M12 Reports. Read-only: nothing here is audited. Every report is guarded
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
}
