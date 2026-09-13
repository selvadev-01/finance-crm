import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { resolveTestDatabaseUrl } from './database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Applies migrations to the `test` schema once per run, before any test file
 * executes.
 *
 * `migrate deploy` rather than `migrate dev`: deploy only applies existing
 * migrations and never prompts, generates or resets. A harness that could
 * author migrations, or reset a database on drift, is a harness that can
 * destroy data on a bad day.
 */
export default function setup(): void {
  config({ path: path.join(repoRoot, '.env') });

  // Throws unless the URL resolves to the `test` schema.
  const testDatabaseUrl = resolveTestDatabaseUrl();

  execFileSync(
    'pnpm',
    ['--filter', '@repo/db', 'exec', 'prisma', 'migrate', 'deploy'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    },
  );
}
