import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createStaff } from './fixtures.js';

/**
 * Books slice 5 (ADR-0018) invariants, migration `constraints_books_journal`:
 * a journal says why, and is never changed or removed.
 */
describe('journal constraints (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function journal(tx: PrismaClient, note = 'Rent booked as misc') {
    const { organization } = await createLine(tx);
    const owner = await createStaff(tx, organization.id, 'ADMIN');
    return tx.journalEntry.create({
      data: {
        organizationId: organization.id,
        businessDate: new Date('2026-01-05'),
        note,
        createdByUserId: owner.userId,
      },
    });
  }

  it('accepts a journal with a reason', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        await journal(tx);
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a blank reason', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        await journal(tx, '   ');
      }),
    ).rejects.toThrow('journal_entry_note_not_blank_check');
  });

  it('refuses to change or delete a journal', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const row = await journal(tx);
        await tx.journalEntry.update({
          where: { id: row.id },
          data: { note: 'Something else' },
        });
      }),
    ).rejects.toThrow('books_entry_append_only');
    await expect(
      withRollback(prisma, async (tx) => {
        const row = await journal(tx);
        await tx.journalEntry.delete({ where: { id: row.id } });
      }),
    ).rejects.toThrow('books_entry_append_only');
  });
});
