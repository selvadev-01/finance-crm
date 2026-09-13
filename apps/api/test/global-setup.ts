import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { resolveDatabaseUrl } from './database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Refuses to run the suite against a database with pending migrations.
 *
 * Tests share the development schema, so applying migrations here would change
 * the development database as a side effect of running tests. Instead the
 * harness checks, and the developer applies them deliberately with
 * `pnpm --filter @repo/db db:deploy`. `migrate status` exits non-zero when a
 * migration is pending or the history has diverged.
 */
export default function setup(): void {
  config({ path: path.join(repoRoot, '.env') });

  const databaseUrl = resolveDatabaseUrl();

  try {
    execFileSync(
      'pnpm',
      ['--filter', '@repo/db', 'exec', 'prisma', 'migrate', 'status'],
      {
        cwd: repoRoot,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
  } catch (error) {
    const output = String((error as { stdout?: Buffer }).stdout ?? '');
    throw new Error(
      'The database is not up to date with prisma/migrations. Run ' +
        '`pnpm --filter @repo/db db:deploy` and try again.\n\n' +
        output,
    );
  }
}
