import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { Database } from '../../src/platform/database/database.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testEmail,
} from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * The transaction helper (M16). BR-18 depends on it: a money write and its
 * ledger posting must commit or fail together.
 *
 * Nothing here commits. Every test either fails its outermost transaction on
 * purpose or runs inside `withRollback`, and cleanup by run tag is a backstop.
 */
describe('Database transaction helper', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  const createUser = (client: Pick<PrismaClient, 'user'>, email: string) =>
    client.user.create({ data: { id: randomUUID(), name: 'Tx Probe', email } });

  /**
   * Found 2026-09-16: Prisma's pg adapter sends a `DateTime` without an
   * offset, so PostgreSQL reads it in the session's time zone. With the
   * session on `Asia/Kolkata`, every instant the application wrote was stored
   * 5½ hours early — and the application could not see it, because reads
   * shifted back by the same amount. The connection pins the session to UTC
   * (`UTC_SESSION`); this compares an application-written instant with the
   * database's own clock, which no shift can fool.
   */
  it('stores an instant as the moment it happened, whatever the machine’s time zone', async () => {
    await withRollback(prisma, async (tx) => {
      const written = new Date();
      const user = await createUser(tx, testEmail('clock'));
      await tx.notification.create({
        data: {
          userId: user.id,
          category: 'ALERT',
          eventType: 'LOW_COLLECTION',
          title: 'Clock probe',
          body: 'Clock probe',
          readAt: written,
        },
      });
      const [row] = await tx.$queryRaw<{ drift_seconds: number }[]>`
        SELECT EXTRACT(EPOCH FROM (now() - "readAt")) AS drift_seconds
        FROM notification
        WHERE "userId" = ${user.id}`;
      // Seconds apart at most; a time-zone shift would be thousands.
      expect(Math.abs(Number(row?.drift_seconds ?? 0))).toBeLessThan(120);
    });
  });

  it('outside a transaction, client is the base client', () => {
    const database = new Database(prisma);
    expect(database.client).toBe(prisma);
    expect(database.inTransaction).toBe(false);
  });

  it('inside a transaction, client is the transaction — so repositories join it without being told', async () => {
    const database = new Database(prisma);
    const failure = new Error('roll back');

    await expect(
      database.transaction(async (tx) => {
        expect(database.client).toBe(tx);
        expect(database.inTransaction).toBe(true);
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('a nested transaction joins the outer one rather than opening its own', async () => {
    const database = new Database(prisma);
    const failure = new Error('roll back');

    await expect(
      database.transaction(async (outer) => {
        await database.transaction(async (inner) => {
          expect(inner).toBe(outer);
        });
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('when the outer transaction fails, a write made by a nested call is rolled back too (BR-18)', async () => {
    const database = new Database(prisma);
    const email = testEmail('nested-rollback');

    await expect(
      database.transaction(async () => {
        // Stands in for the ledger posting written by another service.
        await database.transaction((tx) => createUser(tx, email));
        expect(await database.client.user.count({ where: { email } })).toBe(1);
        throw new Error('collection write failed after the posting');
      }),
    ).rejects.toThrow('collection write failed');

    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('when a nested call fails, the outer transaction fails with it', async () => {
    const database = new Database(prisma);
    const email = testEmail('inner-failure');

    await expect(
      database.transaction(async () => {
        await createUser(database.client, email);
        await database.transaction(async () => {
          throw new Error('posting rejected');
        });
      }),
    ).rejects.toThrow('posting rejected');

    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('is not left in a transaction after one completes', async () => {
    const database = new Database(prisma);
    await database.transaction(async () => undefined);
    expect(database.client).toBe(prisma);
  });

  it('under withRollback the base client is already a transaction, and transaction() joins it', async () => {
    const email = testEmail('tier-one');

    await withRollback(prisma, async (tx) => {
      const database = new Database(tx);
      expect(database.inTransaction).toBe(true);

      await database.transaction(async (joined) => {
        expect(joined).toBe(tx);
        await createUser(joined, email);
      });
      expect(await tx.user.count({ where: { email } })).toBe(1);
    });

    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
