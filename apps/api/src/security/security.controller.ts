import { Controller } from '@nestjs/common';
import {
  type RouteInput,
  type RouteSuccess,
  securityContract as api,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { SecurityEventsService } from './security-events.service.js';

/**
 * M13 — the refused attempts (ADR-0014). `audit.view`, so the roles that read
 * the audit log read this beside it (rbac-matrix.md, "View audit log"): both
 * record everyone's activity, and neither belongs to a Senior or a Junior.
 */
@Controller()
export class SecurityController {
  constructor(private readonly events: SecurityEventsService) {}

  @RequirePermission('audit.view')
  @ContractRoute(api.listSecurityEvents)
  listSecurityEvents(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listSecurityEvents>,
  ): Promise<RouteSuccess<typeof api.listSecurityEvents>> {
    return this.events.list(context, query);
  }
}
