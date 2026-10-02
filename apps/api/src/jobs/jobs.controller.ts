import { Controller } from '@nestjs/common';
import { jobsContract as api, type RouteSuccess } from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { ContractRoute } from '../platform/contract/contract-route.js';
import { JobsService } from './jobs.service.js';

/** M14 job status, read-only. There is no replay or manual trigger here. */
@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @RequirePermission('job.view')
  @ContractRoute(api.listJobs)
  listJobs(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.listJobs>> {
    return this.jobs.overview(context);
  }
}
