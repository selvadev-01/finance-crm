import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createStaff } from './fixtures.js';

/**
 * Books slice 3 (ADR-0018) invariants, migration
 * `constraints_field_expenses`: a field expense names the hop it comes out
 * of and never changes it, and a line's day counts approved field expenses
 * in its discrepancy.
 */
describe('field expense constraints (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient) {
    const { organization, line } = await createLine(tx);
    const junior = await createStaff(tx, organization.id, 'JUNIOR');
    const admin = await createStaff(tx, organization.id, 'ADMIN');
    const category = await tx.expenseCategory.create({
      data: { organizationId: organization.id, name: 'Fuel & travel' },
    });
    const expense = (extra: object = {}) =>
      tx.expense.create({
        data: {
          organizationId: organization.id,
          expenseCategoryId: category.id,
          amount: '50.00',
          businessDate: new Date('2026-01-05'),
          note: 'Petrol',
          paidFrom: 'CASH_IN_HAND',
          spenderUserId: junior.userId,
          lineId: line.id,
          hop: 'JUNIOR_TO_SENIOR',
          status: 'PENDING',
          createdByUserId: junior.userId,
          ...extra,
        },
      });
    return { line, admin, expense };
  }

  it('rejects a field expense without its hop, and an office expense with one', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const w = await world(tx);
        await w.expense({ hop: null });
      }),
    ).rejects.toThrow('expense_hop_check');
    await expect(
      withRollback(prisma, async (tx) => {
        const w = await world(tx);
        await w.expense({
          paidFrom: 'OFFICE_CASH',
          spenderUserId: null,
          lineId: null,
          status: 'APPROVED',
          decidedByUserId: w.admin.userId,
          decidedAt: new Date(),
          createdByUserId: w.admin.userId,
        });
      }),
    ).rejects.toThrow('expense_hop_check');
  });

  it('refuses to move a field expense to another hop', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const w = await world(tx);
        const row = await w.expense();
        await tx.expense.update({
          where: { id: row.id },
          data: { hop: 'SENIOR_TO_OFFICE' },
        });
      }),
    ).rejects.toThrow('expense_guard');
  });

  describe('day_close', () => {
    const day = (tx: PrismaClient, lineId: string, figures: object) =>
      tx.dayClose.create({
        data: {
          lineId,
          businessDate: new Date('2026-01-05'),
          expectedTotal: '1000.00',
          collectedTotal: '1000.00',
          cashReceivedTotal: '950.00',
          ...figures,
        } as never,
      });

    it('accepts a discrepancy of cash received plus expenses less collected', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await day(tx, w.line.id, {
            expenseTotal: '50.00',
            discrepancy: '0.00',
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a discrepancy that leaves the expenses out, and negative expenses', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await day(tx, w.line.id, {
            expenseTotal: '50.00',
            discrepancy: '-50.00',
          });
        }),
      ).rejects.toThrow('day_close_discrepancy_derivation_check');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await day(tx, w.line.id, {
            expenseTotal: '-10.00',
            discrepancy: '-60.00',
          });
        }),
      ).rejects.toThrow('day_close_expense_total_check');
    });
  });
});
