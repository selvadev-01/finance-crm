import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
}

/**
 * Mutating `process.env` here, at config scope, is what actually reaches the
 * application. Config evaluation happens in the parent process before workers
 * are forked, and workers inherit the environment. Vitest's `test.env` is
 * applied too late for a module that reads `DATABASE_URL` while importing —
 * which `@repo/db` effectively does, since it is consumed as built `dist`.
 */
process.env['DATABASE_URL'] = databaseUrl;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL: databaseUrl,
      WEB_ORIGIN: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      BETTER_AUTH_SECRET:
        process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-not-for-production',
      // Tests that assert on logs raise the level on their own captured stream.
      LOG_LEVEL: 'silent',
    },
    // Fails the run if migrations are pending; never applies them.
    globalSetup: ['./test/global-setup.ts'],
    // These tests write through the real app into the development schema and
    // clean up by run tag, so they cannot run concurrently against each other.
    fileParallelism: false,
  },
});
