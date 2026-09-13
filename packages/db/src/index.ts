import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client.js";

export * from "./generated/client.js";

/**
 * The Prisma client, constructed on first use.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **Nothing connects at import time.** Constructing `PrismaClient` opens no
 *    socket, and the `DATABASE_URL` check below runs on first property access
 *    rather than on import. Both matter because `@better-auth/cli generate`
 *    loads `auth.config.ts`, which imports this module, before a database
 *    necessarily exists — an eager connection there hangs the CLI.
 *
 * 2. **Application code does not import this singleton.** Every NestJS provider
 *    receives Prisma through DI so the test harness can substitute a
 *    transaction-bound client and roll back per test. The sanctioned exception
 *    is `apps/api/src/auth/auth.config.ts`, because Better Auth's Prisma
 *    adapter takes a client instance directly (authentication.md).
 */
let client: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (client) return client;

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }

  // `?schema=` is a Prisma-specific query parameter, not a PostgreSQL one.
  // The Prisma CLI parses it — so `migrate deploy` targets the right schema —
  // but `pg` silently ignores unknown parameters, so under Prisma 7's driver
  // adapters it does NOT set search_path at runtime. Left unhandled, that
  // means migrations apply to one schema while queries read and write another.
  //
  // This is how the test harness writes to `test` instead of `public`, so
  // getting it wrong is not a broken test, it is deleted development data.
  const schema = new URL(connectionString).searchParams.get("schema");

  client = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString },
      schema ? { schema } : undefined,
    ),
  });
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getPrismaClient();
    const value = Reflect.get(instance, property) as unknown;
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
