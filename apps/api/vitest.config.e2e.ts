import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

/**
 * Point the application under test at the `test` schema.
 *
 * This has to happen in the config, not in a setup file. The NestJS app reads
 * `DATABASE_URL` through `@repo/db`, which is consumed as built `dist` — by
 * the time a setup file runs, module resolution has already begun and the app
 * picks up whatever `DATABASE_URL` was on the environment. Setting it here
 * puts the right value in the worker environment before anything loads.
 *
 * Getting this wrong is not a test failure, it is data loss: the app writes to
 * `public` while the harness truncates `test`, so a suite that looks merely
 * broken is quietly deleting development data.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
}
if (new URL(testDatabaseUrl).searchParams.get('schema') !== 'test') {
  throw new Error(
    'Refusing to run: TEST_DATABASE_URL does not name the `test` schema.',
  );
}

/**
 * Mutating `process.env` here, at config scope, is what actually reaches the
 * application. Config evaluation happens in the parent process before workers
 * are forked, and workers inherit the environment. Vitest's `test.env` is
 * applied too late for a module that reads `DATABASE_URL` while importing —
 * which `@repo/db` effectively does, since it is consumed as built `dist`.
 */
process.env['DATABASE_URL'] = testDatabaseUrl;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      WEB_ORIGIN: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      BETTER_AUTH_SECRET:
        process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-not-for-production',
    },
    // Applies migrations to the `test` schema once, before any test runs.
    globalSetup: ['./test/global-setup.ts'],
    // These tests share one schema and clean up by truncation, so they cannot
    // run concurrently against each other.
    fileParallelism: false,
  },
});
