import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Prisma } from '@repo/db';
import { PgBoss } from 'pg-boss';

import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';

/** pg-boss's tables live in their own schema, created once by a superuser (M14). */
export const JOB_SCHEMA = 'pgboss';

/** M14 retry policy: exponential backoff, five attempts, then dead-letter. */
export const RETRY = { retryLimit: 5, retryBackoff: true } as const;

/**
 * The job queue (M14, ADR-0004): pg-boss on the application's own database.
 *
 * `start()` is called by `JobsModule` only in worker mode. **Enqueue inside the
 * transaction of the change that causes the job** with `enqueue(tx, …)`: the
 * job row is written through that transaction, so a rolled-back change never
 * leaves a job behind, and a committed one is never missing its job.
 */
@Injectable()
export class JobQueue implements OnApplicationShutdown {
  readonly boss: PgBoss;
  private started = false;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.boss = new PgBoss({
      connectionString: config.DATABASE_URL,
      schema: JOB_SCHEMA,
      // The schema is created once by a superuser (M14). Left to itself,
      // pg-boss runs `CREATE SCHEMA IF NOT EXISTS`, which PostgreSQL refuses to
      // `rasi` ("permission denied for database") even when it already exists.
      createSchema: false,
      application_name: 'rasi-jobs',
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  /** Sends a job through the caller's Prisma transaction (ADR-0004). */
  async enqueue(
    tx: Prisma.TransactionClient,
    name: string,
    data: object,
    options: { singletonKey?: string } = {},
  ): Promise<string | null> {
    return this.boss.send(name, data, {
      ...options,
      db: {
        executeSql: async (text, values = []) => ({
          rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
        }),
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true });
  }
}
