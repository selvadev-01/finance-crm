import { getPrismaClient } from '@repo/db';
import { parseCalendarDate, toBusinessDate } from '@repo/domain';

import { PasswordHasher } from '../identity/password-hasher.js';
import { loadConfig } from '../platform/config/config.js';
import { Database } from '../platform/database/database.js';
import {
  SEED_ORGANIZATION_NAME,
  SEED_PASSWORD,
  type SeedReport,
  seedDataset,
} from './seed.js';
import { verifySeed } from './verify.js';

/**
 * `pnpm --filter api seed [--commit] [--as-of=YYYY-MM-DD]`
 *
 * **Dry run by default.** The whole dataset is written in one transaction,
 * the deferred ledger and cash constraints are forced to fire, the money
 * invariants are verified — and then everything is rolled back. Only
 * `--commit` keeps it, and a committed seed cannot be removed: collections,
 * ledger rows and audit rows are append-only (BR-14, ADR-0006).
 */
const ROLLBACK = Symbol('dry-run rollback');

async function main() {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('The seed never runs against production');
  }
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const asOfArgument = args.find((arg) => arg.startsWith('--as-of='));
  const asOf = asOfArgument
    ? parseCalendarDate(asOfArgument.slice('--as-of='.length))
    : toBusinessDate(new Date());

  const prisma = getPrismaClient();
  if (
    await prisma.organization.findFirst({
      where: { name: SEED_ORGANIZATION_NAME },
    })
  ) {
    throw new Error(
      `"${SEED_ORGANIZATION_NAME}" already exists; the seed runs once per database`,
    );
  }

  const passwordHash = await new PasswordHasher().hash(SEED_PASSWORD);
  let report: SeedReport | undefined;
  const started = Date.now();

  try {
    await new Database(prisma).transaction(
      async (tx) => {
        report = await seedDataset(tx, {
          asOf,
          lines: 5,
          customers: 230,
          concurrentCustomers: 10,
          historyWorkingDays: 60,
          passwordHash,
        });
        // Fire the deferred balancing and denomination triggers now.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        const problems = await verifySeed(tx, report);
        if (problems.length > 0) {
          throw new Error(
            `Seed verification failed:\n  - ${problems.join('\n  - ')}`,
          );
        }
        if (!commit) throw ROLLBACK;
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    `${commit ? 'COMMITTED' : 'DRY RUN — rolled back, nothing kept'} in ${seconds}s, as of ${asOf}\n` +
      `${JSON.stringify(report?.counts, null, 2)}\n` +
      `Verified: ledger balanced, receivables = outstanding, profit and cash reconcile, named cases present.\n` +
      (commit
        ? `Staff sign in with password "${SEED_PASSWORD}":\n  ${report?.staffEmails.join('\n  ')}\n`
        : 'Run again with --commit to keep it. A committed seed cannot be removed.\n'),
  );
  await prisma.$disconnect();
}

await main();
