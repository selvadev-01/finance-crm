import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env.');
}
if (new URL(testDatabaseUrl).searchParams.get('schema') !== 'test') {
  throw new Error(
    'Refusing to run: TEST_DATABASE_URL does not name the `test` schema.',
  );
}

// Set at config scope so forked workers inherit it. See vitest.config.e2e.ts
// for why `test.env` is not sufficient.
process.env['DATABASE_URL'] = testDatabaseUrl;

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      WEB_ORIGIN: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      BETTER_AUTH_SECRET:
        process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-not-for-production',
    },
    // Applies migrations to the `test` schema once, before any test runs.
    globalSetup: ['./test/global-setup.ts'],
    // One schema, shared. Tier 1 tests roll back, but they still share a
    // connection pool.
    fileParallelism: false,
  },
});
