import { Inject, Injectable } from '@nestjs/common';
import type { JobsOverview } from '@repo/contracts';

import { inScope, jobStatusScope } from '../access/scope.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { jobSchedules } from './schedule.js';

/**
 * M14's job status screen: every scheduled job, with how it last ran for the
 * caller's organization — including one that has never run, shown as such.
 */
@Injectable()
export class JobsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: Database,
  ) {}

  async overview(context: RequestContext): Promise<JobsOverview> {
    const rows = await this.database.client.jobStatus.findMany({
      where: inScope(jobStatusScope(context)),
    });
    const byJob = new Map(rows.map((row) => [row.job, row]));
    const iso = (value: Date | null | undefined) =>
      value ? value.toISOString() : null;
    return {
      workerEnabled: this.config.WORKER_ENABLED,
      jobs: jobSchedules(this.config).map(({ name, cron }) => {
        const row = byJob.get(name);
        return {
          job: name,
          schedule: cron,
          lastStartedAt: iso(row?.lastStartedAt),
          lastFinishedAt: iso(row?.lastFinishedAt),
          lastOutcome: (row?.lastOutcome ??
            null) as JobsOverview['jobs'][number]['lastOutcome'],
          lastError: row?.lastError ?? null,
          lastSucceededAt: iso(row?.lastSucceededAt),
          deadLetteredAt: iso(row?.deadLetteredAt),
        };
      }),
    };
  }
}
