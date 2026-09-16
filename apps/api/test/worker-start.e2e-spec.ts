import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';

import { ScheduledJobs } from '../src/jobs/scheduled-jobs.js';
import { captureLogs, createTestApp } from './app.js';

/**
 * M14, decided 2026-09-15: **a worker that cannot start does not take the API
 * down.** The first real worker run failed on a missing `pgboss` schema and the
 * whole API stopped with it, leaving no way to record a collection. Recording
 * money matters more than sending a notification, so the failure is logged and
 * the HTTP server keeps serving.
 */
describe('worker start-up (M14)', () => {
  let app: INestApplication<Server> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves on, at error level, when the job worker cannot start', async () => {
    const logs = captureLogs();
    const broken = {
      register: () =>
        Promise.reject(new Error('permission denied for database rasi_dev')),
    };

    app = await createTestApp({
      // The suites log at `silent`; this one is about what gets logged.
      config: { WORKER_ENABLED: true, LOG_LEVEL: 'error' },
      logDestination: logs,
      overrides: [[ScheduledJobs, broken]],
    });

    await request(app.getHttpServer()).get('/health/live').expect(200);
    const failure = logs
      .lines()
      .find((line) =>
        String(line['msg']).startsWith('The job worker did not start'),
      );
    expect(failure).toBeDefined();
    expect(failure?.['level']).toBe(50);
    // The cause is kept: `err` is a safe log key, and an operator needs it.
    expect(logs.text()).toContain('permission denied for database');
  });

  it('starts no worker at all by default, so tests and the API queue nothing', async () => {
    const logs = captureLogs();
    let registered = 0;
    app = await createTestApp({
      logDestination: logs,
      overrides: [
        [
          ScheduledJobs,
          {
            register: () => {
              registered += 1;
              return Promise.resolve();
            },
          },
        ],
      ],
    });

    await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(registered).toBe(0);
  });
});
