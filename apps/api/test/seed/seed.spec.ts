import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';

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
    const run = () =>
      withRollback(prisma, (tx) =>
        seedDataset(tx, {
          asOf: parseCalendarDate('2026-09-13'),
          lines: 2,
          customers: 10,
          concurrentCustomers: 2,
          historyWorkingDays: 30,
          passwordHash,
        }),
      );
    const first = await run();
    const second = await run();
    expect(second.counts).toEqual(first.counts);
  }, 120_000);
});
