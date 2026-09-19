import { Controller } from '@nestjs/common';
import {
  dashboardContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';
import { parseCalendarDate } from '@repo/domain';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { BusinessOverviewService } from './business-overview.service.js';
import { DashboardTrendService } from './dashboard-trend.service.js';
import { LineDashboardService } from './line-dashboard.service.js';
import { OperationsDashboardService } from './operations-dashboard.service.js';
import { SectorComparisonService } from './sector-comparison.service.js';

/** M11 Dashboards. Read-only: nothing here is audited. */
@Controller()
export class DashboardController {
  constructor(
    private readonly overview: BusinessOverviewService,
    private readonly operations: OperationsDashboardService,
    private readonly lines: LineDashboardService,
    private readonly sectors: SectorComparisonService,
    private readonly trend: DashboardTrendService,
  ) {}

  /**
   * S-07 (US-080). Business-wide figures, so `money.businessTotals` — Super
   * Admin and Admin: S-07 says an Admin sees the same, with settings absent
   * (rbac-matrix.md#money-visibility-m09-m11-m12).
   */
  @RequirePermission('money.businessTotals')
  @ContractRoute(api.getOverview)
  getOverview(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getOverview>,
  ): Promise<RouteSuccess<typeof api.getOverview>> {
    return this.overview.view(
      context,
      query.date === undefined ? undefined : parseCalendarDate(query.date),
    );
  }

  /**
   * US-081. Per-sector figures, so `money.sectorTotals` — Super Admin and
   * Admin (rbac-matrix.md#money-visibility-m09-m11-m12).
   */
  @RequirePermission('money.sectorTotals')
  @ContractRoute(api.getSectors)
  getSectors(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getSectors>,
  ): Promise<RouteSuccess<typeof api.getSectors>> {
    return this.sectors.view(
      context,
      query.date === undefined ? undefined : parseCalendarDate(query.date),
    );
  }

  /**
   * S-20 (US-082). Business-wide figures, so `money.businessTotals` — Admin
   * and Super Admin (rbac-matrix.md#money-visibility-m09-m11-m12).
   */
  @RequirePermission('money.businessTotals')
  @ContractRoute(api.getOperations)
  getOperations(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getOperations>,
  ): Promise<RouteSuccess<typeof api.getOperations>> {
    return this.operations.view(
      context,
      query.date === undefined ? undefined : parseCalendarDate(query.date),
    );
  }

  /**
   * S-19 (US-083). One line's totals, so `money.lineTotals` — Admins, and a
   * Senior for their own line (rbac-matrix.md#money-visibility-m09-m11-m12).
   * Which line is scope's decision, in the service: another line is `404`.
   */
  @RequirePermission('money.lineTotals')
  @ContractRoute(api.getLine)
  getLine(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getLine>,
  ): Promise<RouteSuccess<typeof api.getLine>> {
    return this.lines.view(context, {
      date:
        query.date === undefined ? undefined : parseCalendarDate(query.date),
      lineId: query.lineId,
    });
  }

  /**
   * The dashboards' trend (S-07, S-19, S-20). Line totals summed over the
   * caller's scoped lines, so `money.lineTotals`: Admins every line — the
   * business — and a Senior their own; another line is `404`
   * (rbac-matrix.md#money-visibility-m09-m11-m12).
   */
  @RequirePermission('money.lineTotals')
  @ContractRoute(api.getTrend)
  getTrend(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.getTrend>,
  ): Promise<RouteSuccess<typeof api.getTrend>> {
    return this.trend.view(context, {
      date:
        query.date === undefined ? undefined : parseCalendarDate(query.date),
      days: query.days,
      lineId: query.lineId,
    });
  }
}
