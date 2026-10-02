import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createStaff } from './fixtures.js';

/**
 * Books slice 2 (ADR-0018) invariants, migration `constraints_books_money`:
 * an expense's shape and its one decision, append-only movements, and
 * same-organization references.
 */
describe('books money constraints (ADR-0018)', () => {
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
    const admin = await createStaff(tx, organization.id, 'ADMIN');
    const junior = await createStaff(tx, organization.id, 'JUNIOR');
    const category = await tx.expenseCategory.create({
      data: { organizationId: organization.id, name: 'Fuel & travel' },
    });
    const bank = await tx.bankAccount.create({
      data: { organizationId: organization.id, name: 'SBI Mylapore' },
    });
    return { org: organization.id, line, admin, junior, category, bank };
  }

  type World = Awaited<ReturnType<typeof world>>;

  const office = (w: World, extra: object = {}) => ({
    organizationId: w.org,
    expenseCategoryId: w.category.id,
    amount: '3000.00',
    businessDate: new Date('2026-01-05'),
    note: 'Rent for January',
    paidFrom: 'OFFICE_CASH' as const,
    status: 'APPROVED' as const,
    decidedByUserId: w.admin.userId,
    decidedAt: new Date(),
    createdByUserId: w.admin.userId,
    ...extra,
  });

  const field = (w: World, extra: object = {}) => ({
    organizationId: w.org,
    expenseCategoryId: w.category.id,
    amount: '50.00',
    businessDate: new Date('2026-01-05'),
    note: 'Petrol',
    paidFrom: 'CASH_IN_HAND' as const,
    spenderUserId: w.junior.userId,
    lineId: w.line.id,
    hop: 'JUNIOR_TO_SENIOR' as const,
    status: 'PENDING' as const,
    createdByUserId: w.junior.userId,
    ...extra,
  });

  describe('expense', () => {
    it('accepts an office expense, a bank expense and a pending field expense', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({ data: office(w) });
          await tx.expense.create({
            data: office(w, { paidFrom: 'BANK', bankAccountId: w.bank.id }),
          });
          await tx.expense.create({ data: field(w) });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a zero amount and a blank note', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({ data: office(w, { amount: '0.00' }) });
        }),
      ).rejects.toThrow('expense_amount_positive_check');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({ data: office(w, { note: '  ' }) });
        }),
      ).rejects.toThrow('expense_note_not_blank_check');
    });

    it('rejects a bank on an office-cash expense, and a bank expense with none', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({
            data: office(w, { bankAccountId: w.bank.id }),
          });
        }),
      ).rejects.toThrow('expense_bank_check');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({ data: office(w, { paidFrom: 'BANK' }) });
        }),
      ).rejects.toThrow('expense_bank_check');
    });

    it('rejects a field expense without its spender and line, and an office one carrying them', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({ data: field(w, { lineId: null }) });
        }),
      ).rejects.toThrow('expense_field_check');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({
            data: office(w, {
              spenderUserId: w.junior.userId,
              lineId: w.line.id,
            }),
          });
        }),
      ).rejects.toThrow('expense_field_check');
    });

    it('rejects an office expense left pending', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.expense.create({
            data: office(w, {
              status: 'PENDING',
              decidedByUserId: null,
              decidedAt: null,
            }),
          });
        }),
      ).rejects.toThrow('expense_office_approved_check');
    });

    it('rejects a spender deciding their own field expense', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.expense.create({ data: field(w) });
          await tx.expense.update({
            where: { id: row.id },
            data: {
              status: 'APPROVED',
              decidedByUserId: w.junior.userId,
              decidedAt: new Date(),
            },
          });
        }),
      ).rejects.toThrow('expense_not_self_decided_check');
    });

    it('allows the one decision, then refuses a second, any change to the money, and a delete', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.expense.create({ data: field(w) });
          await tx.expense.update({
            where: { id: row.id },
            data: {
              status: 'APPROVED',
              decidedByUserId: w.admin.userId,
              decidedAt: new Date(),
            },
          });
        }),
      ).resolves.toBeUndefined();
      const decided = (change: object) =>
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.expense.create({ data: office(w) });
          await tx.expense.update({ where: { id: row.id }, data: change });
        });
      await expect(decided({ status: 'REJECTED' })).rejects.toThrow(
        'expense_guard',
      );
      await expect(decided({ amount: '1.00' })).rejects.toThrow(
        'expense_guard',
      );
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.expense.create({ data: office(w) });
          await tx.expense.delete({ where: { id: row.id } });
        }),
      ).rejects.toThrow('expense_guard');
    });

    it("rejects another organization's category, bank or line", async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const other = await world(tx);
          await tx.expense.create({
            data: office(w, { expenseCategoryId: other.category.id }),
          });
        }),
      ).rejects.toThrow('books_entry_same_organization');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const other = await world(tx);
          await tx.expense.create({
            data: field(w, { lineId: other.line.id }),
          });
        }),
      ).rejects.toThrow('books_entry_same_organization');
    });
  });

  describe('bank_transfer, drawing_entry and income_entry', () => {
    it('accepts a deposit, a drawing and other income', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const common = {
            organizationId: w.org,
            amount: '5000.00',
            businessDate: new Date('2026-01-05'),
            note: 'Moved',
            createdByUserId: w.admin.userId,
          };
          await tx.bankTransfer.create({
            data: { ...common, toBankAccountId: w.bank.id },
          });
          await tx.drawingEntry.create({ data: common });
          await tx.incomeEntry.create({
            data: { ...common, bankAccountId: w.bank.id },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a transfer from office cash to office cash, or a bank to itself', async () => {
      const transfer = (sides: object) =>
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          await tx.bankTransfer.create({
            data: {
              organizationId: w.org,
              amount: '5000.00',
              businessDate: new Date('2026-01-05'),
              note: 'Moved',
              createdByUserId: w.admin.userId,
              ...(typeof sides === 'function' ? sides(w) : sides),
            },
          });
        });
      await expect(transfer({})).rejects.toThrow('bank_transfer_sides_check');
      await expect(
        transfer((w: World) => ({
          fromBankAccountId: w.bank.id,
          toBankAccountId: w.bank.id,
        })),
      ).rejects.toThrow('bank_transfer_sides_check');
    });

    it('refuses to change or delete a movement', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.drawingEntry.create({
            data: {
              organizationId: w.org,
              amount: '1000.00',
              businessDate: new Date('2026-01-05'),
              note: 'For home',
              createdByUserId: w.admin.userId,
            },
          });
          await tx.drawingEntry.update({
            where: { id: row.id },
            data: { amount: '1.00' },
          });
        }),
      ).rejects.toThrow('books_entry_append_only');
      await expect(
        withRollback(prisma, async (tx) => {
          const w = await world(tx);
          const row = await tx.incomeEntry.create({
            data: {
              organizationId: w.org,
              amount: '1000.00',
              businessDate: new Date('2026-01-05'),
              note: 'Processing fee',
              createdByUserId: w.admin.userId,
            },
          });
          await tx.incomeEntry.delete({ where: { id: row.id } });
        }),
      ).rejects.toThrow('books_entry_append_only');
    });
  });
});
