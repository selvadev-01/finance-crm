import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@repo/db';

/**
 * The test database connection.
 *
 * Rasi uses ONE database with two schemas: `public` holds development data,
 * `test` belongs to the harness and is truncated between tests. The two URLs
 * differ only by `?schema=`.
 *
 * The guard below is the entire safety mechanism. Truncation is indiscriminate
 * — it deletes every row in every table it is pointed at — so if
 * TEST_DATABASE_URL ever resolves to `public`, a test run destroys the
 * development data and the seed dataset with no warning. Rather than trust
 * configuration, the harness refuses to start unless it can prove it is
 * pointed at the `test` schema.
 */
const TEST_SCHEMA = 'test';

export function resolveTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env and fill it in.',
    );
  }

  const schema = new URL(url).searchParams.get('schema');
  if (schema !== TEST_SCHEMA) {
    throw new Error(
      `Refusing to run tests: TEST_DATABASE_URL resolves to schema ` +
        `"${schema ?? '(none)'}", not "${TEST_SCHEMA}". The harness truncates ` +
        `every table it can see, which would destroy development data.`,
    );
  }

  return url;
}

export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: resolveTestDatabaseUrl() },
      { schema: TEST_SCHEMA },
    ),
  });
}

/**
 * Empty every table in the `test` schema.
 *
 * Used by the HTTP tier, which cannot roll back: a supertest request travels
 * over a socket into a different async context, so the Nest handler uses the
 * application's Prisma client rather than any transaction the test opened.
 *
 * The `table_schema` filter is what keeps this away from `public`.
 */
export async function truncateTestSchema(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = ${TEST_SCHEMA}
      AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables
    .map(({ tablename }) => `"${TEST_SCHEMA}"."${tablename}"`)
    .join(', ');

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
