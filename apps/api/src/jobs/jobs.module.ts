import { Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AccountsModule } from '../accounts/accounts.module.js';
import { CollectionsModule } from '../collections/collections.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { JobQueue } from './job-queue.js';
import { ScheduledJobs } from './scheduled-jobs.js';

/**
 * M14 Jobs. `WORKER_ENABLED` is read here and nowhere else (ADR-0003): with it,
 * this process starts pg-boss, creates the queues and schedules, and consumes.
 * Without it — the API's default, and every test suite — no queue starts.
 *
 * **A worker that cannot start does not take the API down** (decided
 * 2026-09-15, after a missing `pgboss` schema failed the boot and left no API
 * at all). Recording a collection matters more than sending a notification, so
 * the failure is logged at error level and the HTTP server keeps serving;
 * queued work waits for a process that starts successfully.
 */
@Module({
  imports: [LedgerModule, AccountsModule, CollectionsModule],
  providers: [JobQueue, ScheduledJobs],
  exports: [JobQueue],
})
export class JobsModule implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scheduled: ScheduledJobs,
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.WORKER_ENABLED) return;
    try {
      await this.scheduled.register();
    } catch (error) {
      this.logger.error(
        { err: error },
        'The job worker did not start: scheduled jobs, notifications and email are not being sent. The API is still serving.',
      );
    }
  }
}
