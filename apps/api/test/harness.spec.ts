import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient, truncateTestSchema } from './database.js';
import { withRollback } from './with-rollback.js';

/**
 * Tests for the test harness itself.
 *
 * A harness that silently fails to isolate is worse than none, because every
 * suite written on top of it inherits the flaw and nobody looks again. These
 * assertions are cheap and they are the reason the rest can be trusted.
 */
describe('test harness', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await truncateTestSchema(prisma);
    await prisma.$disconnect();
  });

  it('writes model queries into the test schema, never public', async () => {
    // The adapter's `schema` option qualifies GENERATED queries — writes land
    // in test."user" — but it does not change the connection's search_path, so
    // `current_schema()` still reports `public` and raw SQL must name its
    // schema explicitly. That asymmetry is the whole reason truncation below
    // filters on `schemaname`.
    const email = `isolation-${randomUUID()}@rasi.test`;
    await prisma.user.create({
      data: { id: randomUUID(), name: 'Isolation Probe', email },
    });

    const [{ count: inTest }] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM test."user" WHERE email = ${email}
    `;
    const [{ count: inPublic }] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM public."user" WHERE email = ${email}
    `;

    expect(Number(inTest)).toBe(1);
    expect(Number(inPublic)).toBe(0);
  });

  it('rolls back every write made inside withRollback', async () => {
    const email = `rollback-${randomUUID()}@rasi.test`;

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

  it('truncates the test schema', async () => {
    const email = `truncate-${randomUUID()}@rasi.test`;
    await prisma.user.create({
      data: { id: randomUUID(), name: 'Truncate Probe', email },
    });

    expect(await prisma.user.count()).toBeGreaterThan(0);

    await truncateTestSchema(prisma);

    expect(await prisma.user.count()).toBe(0);
  });
});
