import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createActiveAccount, decimal } from './fixtures.js';

/**
 * Account lifecycle and schedule invariants, migration
 * `constraints_account_lifecycle`.
 */
describe('account lifecycle constraints (BR-03, BR-05, BR-07)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a first collection date on the disbursement date (BR-03)', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { account } = await createActiveAccount(tx);
        await tx.accountLoan.update({
          where: { id: account.id },
          data: { firstCollectionDate: account.disbursementDate },
        });
      }),
    ).rejects.toThrow('account_loan_first_collection_after_disbursement_check');
  });

  it('rejects COMPLETED without an actual completion date', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { account } = await createActiveAccount(tx);
        await tx.accountLoan.update({
          where: { id: account.id },
          data: { status: 'COMPLETED' },
        });
      }),
    ).rejects.toThrow('account_loan_completed_has_date_check');
  });

  it('accepts COMPLETED with an actual completion date', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { account } = await createActiveAccount(tx);
        await tx.accountLoan.update({
          where: { id: account.id },
          data: {
            status: 'COMPLETED',
            actualCompletionDate: new Date('2026-12-10'),
          },
        });
      }),
    ).resolves.toBeUndefined();
  });

  it.each(['DEFAULTED', 'WRITTEN_OFF'] as const)(
    'rejects %s with a blank closure note',
    async (status) => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { account } = await createActiveAccount(tx);
          await tx.accountLoan.update({
            where: { id: account.id },
            data: { status, closureNote: '   ' },
          });
        }),
      ).rejects.toThrow('account_loan_closure_note_check');
    },
  );

  it('rejects the overdue flag on an account that is not ACTIVE (BR-05)', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { account } = await createActiveAccount(tx);
        await tx.accountLoan.update({
          where: { id: account.id },
          data: {
            isOverdue: true,
            status: 'DEFAULTED',
            closureNote: 'Absconded',
          },
        });
      }),
    ).rejects.toThrow('account_loan_overdue_only_active_check');
  });

  describe('amounts after disbursement', () => {
    it('rejects changing the account and invested amounts once ACTIVE', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { account } = await createActiveAccount(tx);
          await tx.accountLoan.update({
            where: { id: account.id },
            data: {
              accountAmount: decimal('12000.00'),
              investedAmount: decimal('10500.00'),
            },
          });
        }),
      ).rejects.toThrow('account_loan_amounts_immutable');
    });

    it('allows correcting them while the account is still PENDING', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { account } = await createActiveAccount(tx);
          await tx.$executeRawUnsafe(
            `UPDATE "account_loan" SET "status" = 'PENDING' WHERE "id" = $1`,
            account.id,
          );
          await tx.accountLoan.update({
            where: { id: account.id },
            data: {
              accountAmount: decimal('12000.00'),
              investedAmount: decimal('10500.00'),
              outstandingAmount: decimal('12000.00'),
              dailyAmount: decimal('120.00'),
            },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('still allows the collected and outstanding caches to move once ACTIVE', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { account } = await createActiveAccount(tx);
          await tx.accountLoan.update({
            where: { id: account.id },
            data: {
              collectedAmount: decimal('100.00'),
              outstandingAmount: decimal('9900.00'),
            },
          });
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('account_schedule', () => {
    async function insertSlot(
      tx: PrismaClient,
      sequence: number,
      expectedAmount: string,
    ) {
      const { account } = await createActiveAccount(tx);
      return tx.accountSchedule.create({
        data: {
          accountLoanId: account.id,
          sequence,
          dueDate: new Date('2026-09-02'),
          expectedAmount: decimal(expectedAmount),
        },
      });
    }

    it('accepts an uneven final slot of ₹100 (BR-04)', async () => {
      await expect(
        withRollback(prisma, (tx) => insertSlot(tx, 67, '100.00')),
      ).resolves.toBeDefined();
    });

    it('rejects sequence 0', async () => {
      await expect(
        withRollback(prisma, (tx) => insertSlot(tx, 0, '100.00')),
      ).rejects.toThrow('account_schedule_sequence_positive_check');
    });

    it('rejects a slot expecting nothing', async () => {
      await expect(
        withRollback(prisma, (tx) => insertSlot(tx, 1, '0.00')),
      ).rejects.toThrow('account_schedule_expected_positive_check');
    });
  });
});
