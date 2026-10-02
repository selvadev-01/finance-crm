import { Inject, Injectable } from '@nestjs/common';
import { toBusinessDate } from '@repo/domain';
import { PinoLogger } from 'nestjs-pino';

import { OverdueService } from '../accounts/overdue.service.js';
import { IdempotencyPurgeService } from '../collections/idempotency-purge.service.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { ReconciliationService } from '../ledger/reconciliation.service.js';
import { EventNotices } from '../notifications/event-notices.js';
import { PushDispatchService } from '../notifications/push-dispatch.service.js';
import { StaleSubscriptionService } from '../notifications/stale-subscriptions.service.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';
import { JobQueue, RETRY } from './job-queue.js';
import { JobStatusRecorder } from './job-status.recorder.js';
import { jobSchedules } from './schedule.js';

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
 * | `deactivate-stale-subscriptions` | M10 | `StaleSubscriptionService.deactivate`, weekly |
 *
 * Each schedule fires a **trigger** job that fans out one job per organization,
 * so one large organization cannot hold up the rest (no long-running work in a
 * handler). Queues are `stately` — one queued and one active at a time — so a
 * slow run cannot overlap its own next trigger; per-organization jobs are
 * singleton-keyed by organization. Failures retry five times with backoff,
 * then land in a dead-letter queue whose handler logs at error level and, for
 * an organization's job, alerts its Admins (`alertDeadJob`). `detect-missed-collections` is not scheduled:
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
    private readonly stale: StaleSubscriptionService,
    private readonly notices: EventNotices,
    private readonly recorder: JobStatusRecorder,
  ) {}

  /** Worker mode only: queues, schedules and consumers. Idempotent to repeat. */
  async register(): Promise<void> {
    await this.queue.start();
    const runs: Record<string, (system: SystemContext) => Promise<unknown>> = {
      'reconcile-balances': (system) => this.reconciliation.reconcile(system),
      'flag-overdue-accounts': (system) =>
        this.overdue.flag(system, toBusinessDate(new Date())),
      'purge-idempotency-keys': (system) => this.purge.purge(system),
      'dispatch-notifications': (system) => this.push.dispatch(system),
      'dispatch-emails': (system) => this.email.dispatch(system),
      'deactivate-stale-subscriptions': (system) =>
        this.stale.deactivate(system),
    };
    const jobs = jobSchedules(this.config).map((schedule) => ({
      ...schedule,
      run: runs[schedule.name]!,
    }));

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
        await boss.work(`${name}.dead`, ([dead]) =>
          alertDeadJob(
            this.database,
            this.notices,
            this.logger,
            job.name,
            dead,
            this.recorder,
          ),
        );
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
        return runForOrganization(
          this.recorder,
          this.logger,
          job.name,
          job.run,
          system,
        );
      });
    }
  }
}

/**
 * One organization's run of a scheduled job, recorded in `job_status` (M14):
 * RUNNING before, SUCCEEDED or FAILED after. A failure is recorded and then
 * rethrown, so pg-boss still retries it and, in the end, dead-letters it.
 */
export async function runForOrganization(
  recorder: JobStatusRecorder,
  logger: PinoLogger,
  job: string,
  run: (system: SystemContext) => Promise<unknown>,
  system: SystemContext,
): Promise<unknown> {
  await recorder.started(system.organizationId, job);
  try {
    const result = await run(system);
    await recorder.succeeded(system.organizationId, job);
    logger.info(
      { job, organizationId: system.organizationId, jobId: system.runId },
      'Scheduled job ran',
    );
    return result;
  } catch (error) {
    await recorder.failed(system.organizationId, job, error);
    throw error;
  }
}

/**
 * M14 retry policy: "dead-lettered jobs alert Admin". Always logs at error
 * level; a per-organization job also raises `JOB_FAILED` to that
 * organization's Admins and Super Admins, in its own transaction. A trigger
 * job belongs to no organization, so its failure is the log alone.
 */
export async function alertDeadJob(
  database: Database,
  notices: EventNotices,
  logger: PinoLogger,
  job: string,
  dead: { id: string; data: unknown } | undefined,
  recorder: JobStatusRecorder,
): Promise<void> {
  logger.error(
    { job, jobId: dead?.id },
    'A scheduled job exhausted its retries',
  );
  const data = dead?.data as Partial<OrganizationJob> | null | undefined;
  const organizationId = data?.organizationId;
  if (typeof organizationId !== 'string') return;
  await database.transaction(() =>
    notices.jobFailed({ organizationId, job, lastError: null }),
  );
  // The job status screen shows when it last failed for good (M14).
  await recorder.deadLettered(organizationId, job);
}
