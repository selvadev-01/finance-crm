import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import {
  createTestPrismaClient,
  deleteTestRunData,
  testEmail,
} from './database.js';
import { withRollback } from './with-rollback.js';

/**
 * Tests for the test harness itself.
 *
 * The suite shares the development schema, so a harness that fails to isolate
 * does not merely produce flaky tests — it leaves junk in, or deletes rows
 * from, the development data. These assertions are cheap and they are the
 * reason the rest can be trusted.
 */
describe('test harness', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('rolls back every write made inside withRollback', async () => {
    const email = testEmail('rollback');

    await withRollback(prisma, async (tx) => {
      await tx.user.create({
        data: { id: randomUUID(), name: 'Rollback Probe', email },
      });

      // Visible inside the transaction...
      expect(await tx.user.count({ where: { email } })).toBe(1);
    });

    // ...and gone once it rolls back.
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('propagates a genuine failure rather than swallowing it', async () => {
    await expect(
      withRollback(prisma, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('returns the callback result', async () => {
    const value = await withRollback(prisma, async () => 42);
    expect(value).toBe(42);
  });

  it('cleans up rows tagged with this run and leaves every other row alone', async () => {
    const tagged = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Tagged Probe',
        email: testEmail('tagged'),
      },
    });
    // Stands in for development data: same table, no run tag.
    const untagged = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: 'Untagged Probe',
        email: `untagged-${randomUUID()}@rasi.test`,
      },
    });

    try {
      await deleteTestRunData(prisma);

      expect(await prisma.user.count({ where: { id: tagged.id } })).toBe(0);
      expect(await prisma.user.count({ where: { id: untagged.id } })).toBe(1);
    } finally {
      await prisma.user.deleteMany({ where: { id: untagged.id } });
    }
  });
});
