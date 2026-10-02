import { getPrismaClient, type PrismaClient } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toBusinessDate,
  toMoney,
} from '@repo/domain';

import { PasswordHasher } from '../identity/password-hasher.js';
import { loadConfig } from '../platform/config/config.js';
import { Database } from '../platform/database/database.js';
import { SEED_BANK_NAME, seedOfficeBooks } from './office-books.js';
import {
  SEED_ORGANIZATION_NAME,
  SEED_PASSWORD,
  type SeedReport,
  seedDataset,
} from './seed.js';
import { verifySeed } from './verify.js';

/**
 * `pnpm --filter api seed [--commit] [--as-of=YYYY-MM-DD]` — the one seed
 * command.
 *
 * - **No "Rasi Seed" yet:** writes the whole dataset.
 * - **"Rasi Seed" exists:** adds what a seed committed by an older version
 *   lacks — today, the office books (ADR-0018), dated against the seed's own
 *   history — and says the seed is complete when nothing is missing.
 *
 * **Dry run by default.** Everything is written in one transaction, the
 * deferred ledger and cash constraints are forced to fire, the money
 * invariants are verified — and then it is rolled back. Only `--commit` keeps
 * it, and what is committed cannot be removed: collections, ledger rows and
 * audit rows are append-only (BR-14, ADR-0006).
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
    : null;

  const prisma = getPrismaClient();
  const existing = await prisma.organization.findFirst({
    where: { name: SEED_ORGANIZATION_NAME },
    select: { id: true },
  });
  if (existing) {
    await topUp(prisma, existing.id, { commit, asOf });
  } else {
    await seedAll(prisma, { commit, asOf: asOf ?? toBusinessDate(new Date()) });
  }
  await prisma.$disconnect();
}

async function seedAll(
  prisma: PrismaClient,
  { commit, asOf }: { commit: boolean; asOf: CalendarDate },
) {
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
}

/**
 * Brings a committed "Rasi Seed" up to the current dataset. Only the office
 * books are added: the field expenses would change handovers and day closes
 * already closed.
 */
async function topUp(
  prisma: PrismaClient,
  organizationId: string,
  {
    commit,
    asOf: asOfOverride,
  }: { commit: boolean; asOf: CalendarDate | null },
) {
  const hasBooks = await prisma.bankAccount.findFirst({
    where: { organizationId, name: SEED_BANK_NAME },
    select: { id: true },
  });
  if (hasBooks) {
    process.stdout.write(
      `"${SEED_ORGANIZATION_NAME}" is complete — nothing to add.\n` +
        `Staff sign in as seed.<role>@rasi.seed with password "${SEED_PASSWORD}".\n`,
    );
    return;
  }

  // Dated against the seed's own history: the day after its last day close.
  const lastClose = await prisma.dayClose.findFirst({
    where: { line: { organizationId } },
    orderBy: { businessDate: 'desc' },
    select: { businessDate: true },
  });
  const asOf =
    asOfOverride ??
    (lastClose
      ? addCalendarDays(fromUtcMidnight(lastClose.businessDate), 1)
      : null);
  if (!asOf) throw new Error('The seed has no day closes; pass --as-of');
  const holidays = new Set(
    (
      await prisma.holiday.findMany({
        where: { organizationId },
        select: { date: true },
      })
    ).map((holiday) => fromUtcMidnight(holiday.date)),
  );
  const staff = async (role: 'ADMIN' | 'SUPER_ADMIN') => {
    const profile = await prisma.staffProfile.findFirst({
      where: { organizationId, role },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    if (!profile) throw new Error(`The seed has no ${role}`);
    return profile.userId;
  };
  const adminUserId = await staff('ADMIN');
  const superAdminUserId = await staff('SUPER_ADMIN');

  let counts: Record<string, number> | undefined;
  try {
    await new Database(prisma).transaction(
      async (tx) => {
        counts = await seedOfficeBooks(tx, {
          organizationId,
          asOf,
          holidays,
          adminUserId,
          superAdminUserId,
        });
        // Fire the deferred balancing trigger now.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        // Every cached balance in the organization agrees with its entries.
        const unbalanced = await tx.$queryRaw<
          { id: string; balance: string; computed: string }[]
        >`
          SELECT a.id, a.balance::text AS balance,
                 COALESCE(SUM(CASE WHEN e.direction = a."normalBalance" THEN e.amount ELSE -e.amount END), 0)::text AS computed
          FROM ledger_account a
          LEFT JOIN ledger_entry e ON e."ledgerAccountId" = a.id
          WHERE a."organizationId" = ${organizationId}
          GROUP BY a.id
          HAVING a.balance <> COALESCE(SUM(CASE WHEN e.direction = a."normalBalance" THEN e.amount ELSE -e.amount END), 0)`;
        if (unbalanced.length > 0) {
          throw new Error(
            `Balance cache disagrees with entries:\n  - ${unbalanced
              .map((row) => `${row.id}: ${row.balance} ≠ ${row.computed}`)
              .join('\n  - ')}`,
          );
        }
        if (!commit) throw ROLLBACK;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  const bank = commit
    ? await prisma.bankAccount.findFirst({
        where: { organizationId, name: SEED_BANK_NAME },
        select: { ledgerAccounts: { select: { balance: true } } },
      })
    : null;
  process.stdout.write(
    `"${SEED_ORGANIZATION_NAME}" exists; adding the office books it predates (ADR-0018), as of ${asOf}\n` +
      `${commit ? 'COMMITTED' : 'DRY RUN — rolled back, nothing kept'}\n` +
      `${JSON.stringify(counts, null, 2)}\n` +
      'Verified: every transaction balances, every cached balance matches its entries.\n' +
      (commit
        ? `${SEED_BANK_NAME} balance: ${toMoney(bank?.ledgerAccounts[0]?.balance.toString() ?? '0').toString()}\n`
        : 'Run again with --commit to keep it. Ledger rows cannot be removed.\n'),
  );
}

await main();
