import { Inject, Injectable } from '@nestjs/common';
import { toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { OverdueService } from '../accounts/overdue.service.js';
import { IdempotencyPurgeService } from '../collections/idempotency-purge.service.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { ReconciliationService } from '../ledger/reconciliation.service.js';
import { PushDispatchService } from '../notifications/push-dispatch.service.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';
import { JobQueue, RETRY } from './job-queue.js';

/** M14: all schedules declare the business time zone, never server local time. */
const TIME_ZONE = 'Asia/Kolkata';

interface OrganizationJob {
  organizationId: string;
}

/**
 * The scheduled jobs whose owning modules exist (M14, decided 2026-09-14):
 *
 * | Job                        | Owner | What it calls                            |
 * | -------------------------- | ----- | ---------------------------------------- |
 * | `reconcile-balances`       | M09   | `ReconciliationService.reconcile` (US-095) |
 * | `flag-overdue-accounts`    | M05   | `OverdueService.flag`                    |
 * | `purge-idempotency-keys`   | M07   | `IdempotencyPurgeService.purge`          |
 * | `dispatch-notifications`   | M10   | `PushDispatchService.dispatch`, every minute |
 * | `dispatch-emails`          | M10   | `EmailDispatchService.dispatch`, every minute |
 *
 * Each schedule fires a **trigger** job that fans out one job per organization,
 * so one large organization cannot hold up the rest (no long-running work in a
 * handler). Queues are `stately` — one queued and one active at a time — so a
 * slow run cannot overlap its own next trigger; per-organization jobs are
 * singleton-keyed by organization. Failures retry five times with backoff,
 * then land in a dead-letter queue whose handler logs at error level (the
 * Admin alert arrives with M10). `detect-missed-collections` is not scheduled:
 * missed slots are marked when a line closes (M08, decided 2026-09-14).
 */
@Injectable()
export class ScheduledJobs {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: JobQueue,
    private readonly database: Database,
    private readonly logger: PinoLogger,
    private readonly reconciliation: ReconciliationService,
    private readonly overdue: OverdueService,
    private readonly purge: IdempotencyPurgeService,
    private readonly push: PushDispatchService,
    private readonly email: EmailDispatchService,
  ) {}

  /** Worker mode only: queues, schedules and consumers. Idempotent to repeat. */
  async register(): Promise<void> {
    await this.queue.start();
    const jobs: {
      name: string;
      cron: string;
      run: (system: SystemContext) => Promise<unknown>;
    }[] = [
      {
        name: 'reconcile-balances',
        cron: this.config.JOBS_RECONCILE_CRON,
        run: (system) => this.reconciliation.reconcile(system),
      },
      {
        name: 'flag-overdue-accounts',
        cron: this.config.JOBS_OVERDUE_CRON,
        run: (system) => this.overdue.flag(system, toBusinessDate(new Date())),
      },
      {
        name: 'purge-idempotency-keys',
        cron: this.config.JOBS_PURGE_KEYS_CRON,
        run: (system) => this.purge.purge(system),
      },
      {
        name: 'dispatch-notifications',
        cron: '* * * * *',
        run: (system) => this.push.dispatch(system),
      },
      {
        name: 'dispatch-emails',
        cron: '* * * * *',
        run: (system) => this.email.dispatch(system),
      },
    ];

    const boss = this.queue.boss;
    for (const job of jobs) {
      const perOrg = `${job.name}.organization`;
      for (const name of [job.name, perOrg]) {
        await boss.createQueue(`${name}.dead`, { policy: 'standard' });
        await boss.createQueue(name, {
          policy: 'stately',
          ...RETRY,
          deadLetter: `${name}.dead`,
        });
        await boss.work(`${name}.dead`, async ([dead]) => {
          this.logger.error(
            { job: name, jobId: dead?.id },
            'A scheduled job exhausted its retries',
          );
        });
      }
      await boss.schedule(job.name, job.cron, null, { tz: TIME_ZONE });

      await boss.work(job.name, async () => {
        const organizations = await this.database.client.organization.findMany({
          select: { id: true },
        });
        for (const organization of organizations) {
          await boss.send(
            perOrg,
            { organizationId: organization.id } satisfies OrganizationJob,
            {
              singletonKey: organization.id,
            },
          );
        }
      });
      await boss.work<OrganizationJob>(perOrg, async ([work]) => {
        if (!work) return;
        const system: SystemContext = {
          organizationId: work.data.organizationId,
          runId: work.id,
        };
        const result = await job.run(system);
        this.logger.info(
          {
            job: job.name,
            organizationId: system.organizationId,
            jobId: work.id,
          },
          'Scheduled job ran',
        );
        return result;
      });
    }
  }
}
