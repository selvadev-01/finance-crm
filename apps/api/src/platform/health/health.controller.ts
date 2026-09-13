import { readFileSync } from 'node:fs';

import { Controller, Get, Inject, Res } from '@nestjs/common';
import { listMigrationNames } from '@repo/db';
import { BUSINESS_TIME_ZONE, toBusinessDate } from '@repo/domain';
import type { Response } from 'express';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { Database } from '../database/database.js';

type CheckStatus = 'ok' | 'failed';

const DATABASE_CHECK_TIMEOUT_MS = 2_000;

const { version } = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * Health checks (M16). Public — they reveal no data — and deliberately
 * outside `/api`, which is what the web app proxies.
 *
 * The job-queue check in M16's table arrives with M14; pg-boss does not exist
 * yet, so `/health/ready` does not pretend to check it.
 */
@AllowAnonymous()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The process is up. Touches nothing else, so a database outage cannot fail it. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Database reachable and every shipped migration applied. `503` otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const database = await this.checkDatabase();
    const migrations =
      database === 'ok'
        ? await this.checkMigrations()
        : { status: 'failed' as const, pending: null };

    const ready = database === 'ok' && migrations.status === 'ok';
    response.status(ready ? 200 : 503);
    return {
      status: ready ? 'ok' : 'unavailable',
      checks: {
        database: { status: database },
        migrations,
      },
    };
  }

  /**
   * Version and clock. Server time and timezone are reported on purpose: a
   * host with a drifting clock or the wrong zone misfiles business dates
   * (BR-12), and this makes it visible without shell access.
   */
  @Get('info')
  info() {
    const now = new Date();
    return {
      version,
      buildId: this.config.BUILD_ID ?? null,
      serverTime: now.toISOString(),
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      serverUtcOffsetMinutes: -now.getTimezoneOffset(),
      businessTimeZone: BUSINESS_TIME_ZONE,
      businessDate: toBusinessDate(now),
    };
  }

  private async checkDatabase(): Promise<CheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<CheckStatus>((resolve) => {
      timer = setTimeout(() => resolve('failed'), DATABASE_CHECK_TIMEOUT_MS);
    });
    // A constant query with no interpolation; $queryRaw is the only way to
    // issue it (coding-guidelines.md#database).
    const query = this.database.client.$queryRaw`SELECT 1`
      .then((): CheckStatus => 'ok')
      .catch((): CheckStatus => 'failed');
    try {
      return await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pending = shipped with this build but not successfully applied. A failed
   * migration row (unfinished, not rolled back) also fails the check. Counts
   * only: migration names are not published on a public endpoint.
   */
  private async checkMigrations(): Promise<{
    status: CheckStatus;
    pending: number;
    failed: number;
  }> {
    // Constant query, no interpolation (coding-guidelines.md#database).
    const rows = await this.database.client.$queryRaw<
      {
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;

    const applied = new Set(
      rows
        .filter(
          (row) => row.finished_at !== null && row.rolled_back_at === null,
        )
        .map((row) => row.migration_name),
    );
    const failed = rows.filter(
      (row) => row.finished_at === null && row.rolled_back_at === null,
    ).length;
    const pending = listMigrationNames().filter(
      (name) => !applied.has(name),
    ).length;

    return {
      status: pending === 0 && failed === 0 ? 'ok' : 'failed',
      pending,
      failed,
    };
  }
}
