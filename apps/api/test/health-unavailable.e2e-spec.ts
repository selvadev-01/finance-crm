import type { INestApplication } from '@nestjs/common';
import { listMigrationNames } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import { PRISMA_CLIENT } from '../src/platform/database/database.js';
import { createTestApp } from './app.js';

/**
 * `/health/ready` when it must say no. The development database is always up
 * during tests, so the database client is replaced with a stub that fails, or
 * that reports a migration as missing.
 */
describe('health checks when not ready (e2e)', () => {
  let app: INestApplication<Server> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const withDatabase = async (queryRaw: () => Promise<unknown>) => {
    app = await createTestApp({
      overrides: [
        [
          PRISMA_CLIENT,
          { $queryRaw: queryRaw, $disconnect: async () => undefined },
        ],
      ],
    });
    return app;
  };

  it('answers 503 when the database is unreachable, and liveness still answers 200', async () => {
    const server = (
      await withDatabase(() => Promise.reject(new Error('connection refused')))
    ).getHttpServer();

    const ready = await request(server).get('/health/ready').expect(503);
    expect(ready.body).toMatchObject({
      status: 'unavailable',
      checks: {
        database: { status: 'failed' },
        migrations: { status: 'failed' },
      },
    });
    expect(JSON.stringify(ready.body)).not.toContain('connection refused');

    await request(server).get('/health/live').expect(200, { status: 'ok' });
  });

  it('answers 503 with a pending count when a shipped migration is not applied', async () => {
    const shipped = listMigrationNames();
    const appliedAllButLast = shipped.slice(0, -1).map((migration_name) => ({
      migration_name,
      finished_at: new Date(),
      rolled_back_at: null,
    }));
    let call = 0;
    // First query is the reachability check, second reads _prisma_migrations.
    const server = (
      await withDatabase(async () =>
        call++ === 0 ? [{ '?column?': 1 }] : appliedAllButLast,
      )
    ).getHttpServer();

    const ready = await request(server).get('/health/ready').expect(503);
    expect(ready.body.checks).toEqual({
      database: { status: 'ok' },
      migrations: { status: 'failed', pending: 1, failed: 0 },
    });
  });

  it('answers 503 when a migration started but never finished', async () => {
    const rows = listMigrationNames().map((migration_name, index, all) => ({
      migration_name,
      finished_at: index === all.length - 1 ? null : new Date(),
      rolled_back_at: null,
    }));
    let call = 0;
    const server = (
      await withDatabase(async () =>
        call++ === 0 ? [{ '?column?': 1 }] : rows,
      )
    ).getHttpServer();

    const ready = await request(server).get('/health/ready').expect(503);
    expect(ready.body.checks.migrations).toEqual({
      status: 'failed',
      pending: 1,
      failed: 1,
    });
  });
});
