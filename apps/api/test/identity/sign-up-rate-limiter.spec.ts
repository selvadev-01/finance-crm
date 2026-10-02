import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { PostgresSignUpRateLimiter } from '../../src/identity/sign-up-rate-limiter.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * ADR-0012's sign-up limit counted in PostgreSQL, rolled back. Each test uses
 * its own limiter prefix, so no real address's window is touched.
 */
describe('PostgresSignUpRateLimiter (ADR-0012)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const rule = { limit: 2, windowMs: 60_000 };
  const at = (ms: number) => new Date(Date.UTC(2026, 8, 24, 10) + ms);
  const limiter = (tx: PrismaClient, prefix: string) =>
    new PostgresSignUpRateLimiter(new Database(tx), rule, prefix);

  it('allows the limit per address, then refuses until the window passes', async () => {
    await withRollback(prisma, async (tx) => {
      const limit = limiter(tx, `test-${randomUUID()}:`);
      expect(await limit.tryConsume('10.0.0.1', at(0))).toBe(true);
      expect(await limit.tryConsume('10.0.0.1', at(10))).toBe(true);
      expect(await limit.tryConsume('10.0.0.1', at(20))).toBe(false);
      // Another address has its own window.
      expect(await limit.tryConsume('10.0.0.2', at(20))).toBe(true);
      // A new window opens once the old one has passed.
      expect(await limit.tryConsume('10.0.0.1', at(60_000))).toBe(true);
      expect(await limit.tryConsume('10.0.0.1', at(60_010))).toBe(true);
      expect(await limit.tryConsume('10.0.0.1', at(60_020))).toBe(false);
    });
  });

  it('is one counter for every API process: two limiters share an address’s window', async () => {
    await withRollback(prisma, async (tx) => {
      const prefix = `test-${randomUUID()}:`;
      const first = limiter(tx, prefix);
      const second = limiter(tx, prefix);
      expect(await first.tryConsume('10.0.0.1', at(0))).toBe(true);
      expect(await second.tryConsume('10.0.0.1', at(5))).toBe(true);
      expect(await first.tryConsume('10.0.0.1', at(10))).toBe(false);
      expect(await second.tryConsume('10.0.0.1', at(15))).toBe(false);
    });
  });

  it('deletes its own expired windows and no other limiter’s', async () => {
    await withRollback(prisma, async (tx) => {
      const mine = `test-${randomUUID()}:`;
      const theirs = `test-${randomUUID()}:`;
      await limiter(tx, mine).tryConsume('10.0.0.1', at(0));
      await limiter(tx, theirs).tryConsume('10.0.0.1', at(0));

      await limiter(tx, mine).tryConsume('10.0.0.9', at(120_000));

      const keys = (
        await tx.rateLimitWindow.findMany({
          where: {
            OR: [
              { key: { startsWith: mine } },
              { key: { startsWith: theirs } },
            ],
          },
          select: { key: true },
        })
      )
        .map((row) => row.key)
        .sort();
      expect(keys).toEqual([`${mine}10.0.0.9`, `${theirs}10.0.0.1`].sort());
    });
  });
});
