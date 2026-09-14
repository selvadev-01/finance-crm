import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createActiveAccount, createUser, decimal } from './fixtures.js';

/**
 * Collection invariants (M07, BR-08, BR-14), migration
 * `constraints_collection`. Non-negotiable 4: collections are never updated or
 * deleted.
 */
describe('collection constraints (BR-08, BR-14)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  type Row = {
    expectedAmount: string;
    amount: string;
    variance: string;
    classification: 'CORRECT' | 'LOW' | 'EXTRA' | 'NO_PAYMENT';
    entryType?: 'ORIGINAL' | 'ADJUSTMENT';
    adjustsCollectionId?: string | null;
    status?: 'PENDING_APPROVAL' | 'CONFIRMED' | 'REJECTED';
  };

  async function insertCollection(
    tx: PrismaClient,
    row: Row,
    parent?: { accountId: string; lineId: string; userId: string },
  ) {
    const context =
      parent ??
      (await (async () => {
        const { account, line } = await createActiveAccount(tx);
        const user = await createUser(tx);
        return { accountId: account.id, lineId: line.id, userId: user.id };
      })());

    const collection = await tx.collection.create({
      data: {
        idempotencyKey: randomUUID(),
        accountLoanId: context.accountId,
        lineId: context.lineId,
        collectedByUserId: context.userId,
        businessDate: new Date('2026-09-02'),
        capturedAt: new Date('2026-09-02T05:00:00Z'),
        syncedAt: new Date('2026-09-02T05:00:00Z'),
        expectedAmount: decimal(row.expectedAmount),
        amount: decimal(row.amount),
        variance: decimal(row.variance),
        classification: row.classification,
        entryType: row.entryType ?? 'ORIGINAL',
        adjustsCollectionId: row.adjustsCollectionId ?? null,
        status: row.status ?? 'CONFIRMED',
      },
    });
    return { collection, context };
  }

  describe('BR-08 classification — exact match, no tolerance', () => {
    it.each([
      [
        'CORRECT',
        { expectedAmount: '100.00', amount: '100.00', variance: '0.00' },
      ],
      [
        'LOW',
        { expectedAmount: '100.00', amount: '80.00', variance: '-20.00' },
      ],
      [
        'EXTRA',
        { expectedAmount: '100.00', amount: '120.00', variance: '20.00' },
      ],
      [
        'NO_PAYMENT',
        { expectedAmount: '100.00', amount: '0.00', variance: '-100.00' },
      ],
      // BR-07: expected capped at an outstanding ₹50, paid exactly.
      [
        'CORRECT',
        { expectedAmount: '50.00', amount: '50.00', variance: '0.00' },
      ],
    ] as const)('accepts %s for %o', async (classification, amounts) => {
      await expect(
        withRollback(prisma, (tx) =>
          insertCollection(tx, { ...amounts, classification }),
        ),
      ).resolves.toBeDefined();
    });

    it.each([
      [
        'CORRECT on a paisa short',
        'CORRECT',
        { expectedAmount: '100.00', amount: '99.99', variance: '-0.01' },
      ],
      [
        'LOW on an exact payment',
        'LOW',
        { expectedAmount: '100.00', amount: '100.00', variance: '0.00' },
      ],
      [
        'EXTRA on a short payment',
        'EXTRA',
        { expectedAmount: '100.00', amount: '80.00', variance: '-20.00' },
      ],
      [
        'LOW on nothing paid',
        'LOW',
        { expectedAmount: '100.00', amount: '0.00', variance: '-100.00' },
      ],
      [
        'NO_PAYMENT on a payment',
        'NO_PAYMENT',
        { expectedAmount: '100.00', amount: '10.00', variance: '-90.00' },
      ],
    ] as const)('rejects %s', async (_label, classification, amounts) => {
      await expect(
        withRollback(prisma, (tx) =>
          insertCollection(tx, { ...amounts, classification }),
        ),
      ).rejects.toThrow('collection_classification_check');
    });
  });

  it('rejects a variance that is not amount − expected', async () => {
    await expect(
      withRollback(prisma, (tx) =>
        insertCollection(tx, {
          expectedAmount: '100.00',
          amount: '80.00',
          variance: '-10.00',
          classification: 'LOW',
        }),
      ),
    ).rejects.toThrow('collection_variance_derivation_check');
  });

  it('rejects a negative amount on an ORIGINAL', async () => {
    await expect(
      withRollback(prisma, (tx) =>
        insertCollection(tx, {
          expectedAmount: '0.00',
          amount: '-10.00',
          variance: '-10.00',
          classification: 'LOW',
        }),
      ),
    ).rejects.toThrow('collection_amount_sign_check');
  });

  it('accepts a negative ADJUSTMENT that names the collection it corrects', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { collection, context } = await insertCollection(tx, {
          expectedAmount: '100.00',
          amount: '120.00',
          variance: '20.00',
          classification: 'EXTRA',
        });
        await insertCollection(
          tx,
          {
            expectedAmount: '0.00',
            amount: '-20.00',
            variance: '-20.00',
            classification: 'LOW',
            entryType: 'ADJUSTMENT',
            adjustsCollectionId: collection.id,
          },
          context,
        );
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an ADJUSTMENT that names no collection', async () => {
    await expect(
      withRollback(prisma, (tx) =>
        insertCollection(tx, {
          expectedAmount: '0.00',
          amount: '-20.00',
          variance: '-20.00',
          classification: 'LOW',
          entryType: 'ADJUSTMENT',
        }),
      ),
    ).rejects.toThrow('collection_adjustment_reference_check');
  });

  describe('append-only (non-negotiable 4)', () => {
    const correct: Row = {
      expectedAmount: '100.00',
      amount: '100.00',
      variance: '0.00',
      classification: 'CORRECT',
    };

    it('rejects editing the amount of a recorded collection', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection } = await insertCollection(tx, correct);
          await tx.collection.update({
            where: { id: collection.id },
            data: {
              amount: decimal('150.00'),
              variance: decimal('50.00'),
              classification: 'EXTRA',
            },
          });
        }),
      ).rejects.toThrow('collection_append_only: UPDATE');
    });

    it('rejects deleting a collection', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection } = await insertCollection(tx, correct);
          await tx.collection.delete({ where: { id: collection.id } });
        }),
      ).rejects.toThrow('collection_append_only: DELETE');
    });

    const pendingAdjustment = async (tx: PrismaClient) => {
      const { collection, context } = await insertCollection(tx, correct);
      const { collection: adjustment } = await insertCollection(
        tx,
        {
          expectedAmount: '0.00',
          amount: '-20.00',
          variance: '-20.00',
          classification: 'LOW',
          entryType: 'ADJUSTMENT',
          adjustsCollectionId: collection.id,
          status: 'PENDING_APPROVAL',
        },
        context,
      );
      return { collection, adjustment, context };
    };

    it.each(['CONFIRMED', 'REJECTED'] as const)(
      'allows a pending adjustment to be decided %s, the one sanctioned change',
      async (decision) => {
        await expect(
          withRollback(prisma, async (tx) => {
            const { adjustment } = await pendingAdjustment(tx);
            await tx.collection.update({
              where: { id: adjustment.id },
              data: { status: decision },
            });
          }),
        ).resolves.toBeUndefined();
      },
    );

    it('rejects changing a decided adjustment again', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { adjustment } = await pendingAdjustment(tx);
          await tx.collection.update({
            where: { id: adjustment.id },
            data: { status: 'REJECTED' },
          });
          await tx.collection.update({
            where: { id: adjustment.id },
            data: { status: 'CONFIRMED' },
          });
        }),
      ).rejects.toThrow('collection_status_transition');
    });

    it('rejects moving an ORIGINAL out of CONFIRMED', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection } = await insertCollection(tx, correct);
          await tx.collection.update({
            where: { id: collection.id },
            data: { status: 'REVERSED' },
          });
        }),
      ).rejects.toThrow('collection_status_transition');
    });

    it('rejects an ORIGINAL written as anything but CONFIRMED', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          insertCollection(tx, { ...correct, status: 'PENDING_APPROVAL' }),
        ),
      ).rejects.toThrow('collection_original_confirmed_check');
    });

    it('rejects a second pending correction on one collection', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection, context } = await pendingAdjustment(tx);
          await insertCollection(
            tx,
            {
              expectedAmount: '0.00',
              amount: '-10.00',
              variance: '-10.00',
              classification: 'LOW',
              entryType: 'ADJUSTMENT',
              adjustsCollectionId: collection.id,
              status: 'PENDING_APPROVAL',
            },
            context,
          );
        }),
      ).rejects.toThrow('collection_one_pending_correction_key');
    });
  });

  describe('collection_approval', () => {
    it('rejects an approval decision with no decider recorded', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection, context } = await insertCollection(tx, {
            expectedAmount: '100.00',
            amount: '100.00',
            variance: '0.00',
            classification: 'CORRECT',
          });
          await tx.collectionApproval.create({
            data: {
              collectionId: collection.id,
              requestedByUserId: context.userId,
              reason: 'Typed 100 instead of 10',
              decision: 'APPROVED',
              decidedAt: new Date(),
            },
          });
        }),
      ).rejects.toThrow('collection_approval_decided_by_check');
    });

    it('rejects a blank reason', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { collection, context } = await insertCollection(tx, {
            expectedAmount: '100.00',
            amount: '100.00',
            variance: '0.00',
            classification: 'CORRECT',
          });
          await tx.collectionApproval.create({
            data: {
              collectionId: collection.id,
              requestedByUserId: context.userId,
              reason: ' ',
            },
          });
        }),
      ).rejects.toThrow('collection_approval_reason_check');
    });
  });
});
