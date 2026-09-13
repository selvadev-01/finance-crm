import type { PrismaClient } from '@repo/db';

/**
 * Tier 1 isolation: run a test inside a transaction and roll it back.
 *
 * This is the tier that actually delivers "transaction-rollback isolation".
 * It works only for tests that call services and repositories **directly**,
 * because the transaction-bound client has to be handed to the code under test
 * — in NestJS, through `overrideProvider`. It cannot work across HTTP; see
 * `database.ts`.
 *
 * Three details that are easy to omit and expensive to discover later:
 *
 *   1. **`SET CONSTRAINTS ALL IMMEDIATE` before the rollback.** The ledger's
 *      balancing check is a DEFERRED constraint trigger that fires at COMMIT
 *      (BR-18, ADR-0006). A harness that always rolls back never commits, so
 *      without this line every money test in Phase 2 would pass against a
 *      constraint that was never evaluated. Forcing constraints to fire before
 *      the rollback is what makes those tests mean anything.
 *
 *   2. **A raised timeout.** Prisma's interactive-transaction default is five
 *      seconds, which a test doing real work exceeds intermittently — the
 *      failure looks like flakiness rather than configuration.
 *
 *   3. **A sentinel error to trigger the rollback.** Prisma rolls back when
 *      the callback throws; the sentinel is caught here so a passing test does
 *      not surface it, while a genuine failure still propagates.
 */
const ROLLBACK = Symbol('rollback');

export async function withRollback<T>(
  prisma: PrismaClient,
  run: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  let result: T;

  try {
    await prisma.$transaction(
      async (tx) => {
        result = await run(tx as unknown as PrismaClient);

        // Fire deferred constraints now, so the test sees what a real COMMIT
        // would have rejected.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');

        throw ROLLBACK;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  return result!;
}
