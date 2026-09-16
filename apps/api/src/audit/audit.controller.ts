import { Controller } from '@nestjs/common';
import {
  auditContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { AccountHistoryService } from './account-history.service.js';
import { AuditLogService } from './audit-log.service.js';

/** M13 reads — Admins and Super Admins only (rbac-matrix.md, "View audit log"). */
@Controller()
export class AuditController {
  constructor(
    private readonly log: AuditLogService,
    private readonly accounts: AccountHistoryService,
  ) {}

  @RequirePermission('audit.view')
  @ContractRoute(api.listAuditLog)
  listAuditLog(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listAuditLog>,
  ): Promise<RouteSuccess<typeof api.listAuditLog>> {
    return this.log.list(context, query);
  }

  @RequirePermission('audit.view')
  @ContractRoute(api.getAccountHistory)
  getAccountHistory(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.getAccountHistory>,
  ): Promise<RouteSuccess<typeof api.getAccountHistory>> {
    return this.accounts.history(context, params.accountId);
  }
}
