import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UTC_SESSION } from '@repo/db';
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
    // UTC like the application's own client: instants must not depend on the
    // developer's time zone (see UTC_SESSION).
    adapter: new PrismaPg(
      { connectionString, ...UTC_SESSION },
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

/** A code or name that `deleteTestRunData` will clean up — e.g. a line code. */
export function testCode(label: string): string {
  return `${label}-${testRunTag}-${randomUUID().slice(0, 8)}`;
}

/**
 * Delete the rows this test run created through HTTP, and only those.
 *
 * Every delete is matched on `testRunTag` — never a bulk delete. The order
 * follows foreign keys: assignments and customers before the staff and lines
 * they reference; staff (through their user, which cascades to
 * `staff_profile`, `session` and `account`) before their organization.
 *
 * Collections are append-only and cannot be deleted (BR-14), so Tier 2 tests
 * must not create them; collection scope is proven in Tier 1.
 */
export async function deleteTestRunData(prisma: PrismaClient): Promise<void> {
  const taggedEmail = { endsWith: `@${testRunTag}.rasi.test` };
  const taggedCode = { contains: testRunTag };

  await prisma.lineAssignment.deleteMany({
    where: { staffProfile: { user: { email: taggedEmail } } },
  });
  // PENDING accounts only: a disbursed account has ledger rows, which reject
  // DELETE, so Tier 2 never disburses (schedules cascade with the account).
  await prisma.accountLoan.deleteMany({
    where: { organization: { name: taggedCode }, status: 'PENDING' },
  });
  // Customers inserted directly by a test carry a tagged code; customers
  // created over HTTP get an API-issued `CUS-…` code (US-020) and are matched
  // by their tagged organization instead.
  await prisma.customer.deleteMany({
    where: {
      OR: [
        { customerCode: taggedCode },
        { organization: { name: taggedCode } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { email: taggedEmail } });
  // Holidays declared over HTTP (US-093) belong to a tagged organization, and
  // must go before the sectors and organization they reference.
  await prisma.holiday.deleteMany({
    where: { organization: { name: taggedCode } },
  });
  await prisma.line.deleteMany({ where: { code: taggedCode } });
  await prisma.sector.deleteMany({ where: { code: taggedCode } });
  await prisma.organization.deleteMany({ where: { name: taggedCode } });
}
