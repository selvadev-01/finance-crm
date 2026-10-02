import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine } from './fixtures.js';

/** M14's job status, migration `job_status`. */
describe('job_status constraints (M14)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const status = async (tx: PrismaClient, lastOutcome: string) => {
    const { organization } = await createLine(tx);
    return tx.jobStatus.create({
      data: {
        organizationId: organization.id,
        job: 'reconcile-balances',
        lastStartedAt: new Date(),
        lastOutcome,
      },
    });
  };

  it('accepts each outcome an attempt can have', async () => {
    for (const outcome of ['RUNNING', 'SUCCEEDED', 'FAILED']) {
      await expect(
        withRollback(prisma, async (tx) => {
          await status(tx, outcome);
        }),
      ).resolves.toBeUndefined();
    }
  });

  it('rejects any other outcome', async () => {
    await expect(
      withRollback(prisma, (tx) => status(tx, 'DONE')),
    ).rejects.toThrow('job_status_outcome_check');
  });
});
