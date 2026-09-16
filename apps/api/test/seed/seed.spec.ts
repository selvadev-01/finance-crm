import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import { randomInt } from 'node:crypto';

import { PasswordHasher } from '../../src/identity/password-hasher.js';
import { seedDataset, SEED_PASSWORD } from '../../src/seed/seed.js';
import { verifySeed } from '../../src/seed/verify.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * The seed dataset, small, rolled back. Proves the generator produces data the
 * database constraints accept (including the deferred ledger balance, which
 * withRollback fires) and that the money invariants hold.
 */
describe('seed dataset', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * A seed may already be committed to this schema (the seed is permanent), so
   * each run tags the values that are unique database-wide rather than assume
   * `seed.superadmin@rasi.seed` is free.
   */
  const tag = () => String(randomInt(1000, 10_000));

  it('tags the database-wide unique values when given a tag, and refuses a malformed one', async () => {
    await withRollback(prisma, async (tx) => {
      const report = await seedDataset(tx, {
        asOf: parseCalendarDate('2026-09-13'),
        lines: 2,
        customers: 10,
        concurrentCustomers: 2,
        historyWorkingDays: 30,
        passwordHash: 'not-used-for-sign-in',
        tag: tag(),
      });
      expect(report.staffEmails[0]).toMatch(
        /^seed\.superadmin\.\d{4}@rasi\.seed$/,
      );
    });
    await expect(
      withRollback(prisma, (tx) =>
        seedDataset(tx, {
          asOf: parseCalendarDate('2026-09-13'),
          lines: 2,
          customers: 10,
          concurrentCustomers: 2,
          historyWorkingDays: 30,
          passwordHash: 'x',
          tag: 'abc',
        }),
      ),
    ).rejects.toThrow('Seed tag must be four digits');
  }, 120_000);

  it('writes a dataset every constraint accepts and every money invariant holds for', async () => {
    const passwordHash = await new PasswordHasher().hash(SEED_PASSWORD);

    await withRollback(prisma, async (tx) => {
      // The seed organization's name is unique only by convention; a committed
      // seed in this database would not collide, since this rolls back.
      const report = await seedDataset(tx, {
        asOf: parseCalendarDate('2026-09-13'),
        lines: 3,
        customers: 40,
        concurrentCustomers: 4,
        historyWorkingDays: 45,
        passwordHash,
        tag: tag(),
      });
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');

      expect(await verifySeed(tx, report)).toEqual([]);
      expect(report.counts.accounts).toBe(48);
      expect(report.counts.collections).toBeGreaterThan(500);
      expect(report.cases.concurrentCustomerIds).toHaveLength(4);
    });
  }, 120_000);

  it('is reproducible: the same options produce the same counts', async () => {
    const passwordHash = 'not-used-for-sign-in';
    const runTag = tag();
    const run = () =>
      withRollback(prisma, (tx) =>
        seedDataset(tx, {
          asOf: parseCalendarDate('2026-09-13'),
          lines: 2,
          customers: 10,
          concurrentCustomers: 2,
          historyWorkingDays: 30,
          passwordHash,
          tag: runTag,
        }),
      );
    const first = await run();
    const second = await run();
    expect(second.counts).toEqual(first.counts);
  }, 120_000);
});
