import { Injectable } from '@nestjs/common';

import { Database } from '../platform/database/database.js';
import { AppError } from '../platform/errors/errors.js';

/**
 * Keeps `job_status` (M14): one row per organization and scheduled job, with
 * its latest attempt. Called by the worker around each per-organization run
 * and by the dead-letter handler. Each write is its own small transaction —
 * the job's own work commits or rolls back on its own, and a failed job must
 * still be recorded as failed.
 */
@Injectable()
export class JobStatusRecorder {
  constructor(private readonly database: Database) {}

  started(organizationId: string, job: string, at = new Date()) {
    return this.database.transaction((tx) =>
      tx.jobStatus.upsert({
        where: { organizationId_job: { organizationId, job } },
        create: {
          organizationId,
          job,
          lastStartedAt: at,
          lastOutcome: 'RUNNING',
        },
        update: {
          lastStartedAt: at,
          lastFinishedAt: null,
          lastOutcome: 'RUNNING',
          lastError: null,
        },
      }),
    );
  }

  succeeded(organizationId: string, job: string, at = new Date()) {
    return this.database.transaction((tx) =>
      tx.jobStatus.update({
        where: { organizationId_job: { organizationId, job } },
        data: {
          lastFinishedAt: at,
          lastOutcome: 'SUCCEEDED',
          lastSucceededAt: at,
        },
      }),
    );
  }

  failed(organizationId: string, job: string, error: unknown, at = new Date()) {
    return this.database.transaction((tx) =>
      tx.jobStatus.update({
        where: { organizationId_job: { organizationId, job } },
        data: {
          lastFinishedAt: at,
          lastOutcome: 'FAILED',
          lastError: describe(error),
        },
      }),
    );
  }

  /** It exhausted its retries (M14): kept until a later run replaces nothing. */
  deadLettered(organizationId: string, job: string, at = new Date()) {
    return this.database.transaction((tx) =>
      tx.jobStatus.upsert({
        where: { organizationId_job: { organizationId, job } },
        create: {
          organizationId,
          job,
          lastStartedAt: at,
          lastFinishedAt: at,
          lastOutcome: 'FAILED',
          deadLetteredAt: at,
        },
        update: { deadLetteredAt: at },
      }),
    );
  }
}

/**
 * The failure's class and stable code — never its message, which can carry
 * data (a Prisma error quotes the values it refused).
 */
export function describe(error: unknown): string {
  if (error instanceof AppError) return `${error.name} ${error.code}`;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} ${code}` : error.name;
  }
  return 'Unknown error';
}
