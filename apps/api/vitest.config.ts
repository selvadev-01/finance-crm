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

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      DATABASE_URL: databaseUrl,
      WEB_ORIGIN: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      BETTER_AUTH_SECRET:
        process.env['BETTER_AUTH_SECRET'] ?? 'test-secret-not-for-production',
      LOG_LEVEL: 'silent',
    },
    // Fails the run if migrations are pending; never applies them.
    globalSetup: ['./test/global-setup.ts'],
    // Tier 1 tests roll back, but they share the development schema and one
    // connection pool, so files run one at a time.
    fileParallelism: false,
  },
});
