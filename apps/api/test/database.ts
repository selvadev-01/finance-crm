import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

/**
 * The test database connection.
 *
 * Rasi uses ONE database with ONE schema: tests run against `public` in
 * `rasi_dev`, the same schema `pnpm dev` reads and writes. There is no separate
 * test schema, so nothing here may ever delete rows it did not create.
 *
 * That rules out truncation. Isolation comes from two narrower mechanisms:
 *
 *   - **Tier 1** (service and repository tests) — `withRollback`. Every write
 *     happens inside a transaction that is rolled back, so nothing persists.
 *   - **Tier 2** (HTTP tests) — the request crosses a socket into the app's own
 *     Prisma client, so it cannot be rolled back. Every row such a test creates
 *     is tagged with this run's `testRunTag`, and `deleteTestRunData` removes
 *     exactly those rows and nothing else.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in.',
    );
  }
  return url;
}

export function createTestPrismaClient(): PrismaClient {
  const connectionString = resolveDatabaseUrl();
  const schema = new URL(connectionString).searchParams.get('schema');

  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString },
      schema ? { schema } : undefined,
    ),
  });
}

/**
 * A tag unique to this test process. Tier 2 tests put it in every identifying
 * value they create — an email domain, a code — so cleanup can match on it.
 */
export const testRunTag = `run-${randomUUID()}`;

/** An email address that `deleteTestRunData` will clean up. */
export function testEmail(label: string): string {
  return `${label}-${randomUUID()}@${testRunTag}.rasi.test`;
}

/**
 * Delete the rows this test run created through HTTP, and only those.
 *
 * Deleting the user cascades to Better Auth's `session` and `account` rows.
 * When Tier 2 tests start creating domain rows, extend this with a delete per
 * table, matched on `testRunTag` — never a bulk delete.
 */
export async function deleteTestRunData(prisma: PrismaClient): Promise<void> {
  await prisma.user.deleteMany({
    where: { email: { endsWith: `@${testRunTag}.rasi.test` } },
  });
}
