import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createUser } from './fixtures.js';

/**
 * Money put into the business (US-032, M08), migration
 * `constraints_capital_entry`: positive, explained, and never changed.
 */
describe('capital_entry constraints (US-032)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const entry = async (
    tx: PrismaClient,
    data: { amount?: string; note?: string } = {},
  ) => {
    const { organization } = await createLine(tx);
    const user = await createUser(tx);
    return tx.capitalEntry.create({
      data: {
        organizationId: organization.id,
        amount: data.amount ?? '50000.00',
        businessDate: new Date('2026-01-05'),
        note: data.note ?? 'Owner’s savings',
        createdByUserId: user.id,
      },
    });
  };

  it('accepts a positive amount with a note', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        await entry(tx);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a zero or negative amount', async () => {
    for (const amount of ['0.00', '-100.00']) {
      await expect(
        withRollback(prisma, (tx) => entry(tx, { amount })),
      ).rejects.toThrow('capital_entry_amount_positive_check');
    }
  });

  it('rejects a blank note', async () => {
    await expect(
      withRollback(prisma, (tx) => entry(tx, { note: '   ' })),
    ).rejects.toThrow('capital_entry_note_not_blank_check');
  });

  it('rejects changing an entry', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const row = await entry(tx);
        await tx.capitalEntry.update({
          where: { id: row.id },
          data: { amount: '1.00' },
        });
      }),
    ).rejects.toThrow('capital_entry_append_only');
  });

  it('rejects deleting an entry', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const row = await entry(tx);
        await tx.capitalEntry.delete({ where: { id: row.id } });
      }),
    ).rejects.toThrow('capital_entry_append_only');
  });
});
