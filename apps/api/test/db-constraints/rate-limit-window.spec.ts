import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/** ADR-0012's shared rate-limit counter, migration `rate_limit_window`. */
describe('rate_limit_window constraints (ADR-0012)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const window = (tx: PrismaClient, count: number) =>
    tx.rateLimitWindow.create({
      data: { key: `test-${randomUUID()}`, windowStart: new Date(), count },
    });

  it('accepts a window opened by an attempt', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        await window(tx, 1);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a window with no attempts', async () => {
    await expect(withRollback(prisma, (tx) => window(tx, 0))).rejects.toThrow(
      'rate_limit_window_count_positive_check',
    );
  });
});
