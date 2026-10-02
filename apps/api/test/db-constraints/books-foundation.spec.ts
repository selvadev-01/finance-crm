import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine } from './fixtures.js';

/**
 * Books (ADR-0018) invariants, migration `constraints_books_foundation`:
 * keyed ledger accounts, their normal balances, the same-organization rule,
 * and category and bank names.
 */
describe('books foundation constraints (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const organization = async (tx: PrismaClient) =>
    (await createLine(tx)).organization.id;

  const category = (tx: PrismaClient, organizationId: string, name = 'Rent') =>
    tx.expenseCategory.create({ data: { organizationId, name } });

  const bank = (tx: PrismaClient, organizationId: string, name = 'SBI') =>
    tx.bankAccount.create({ data: { organizationId, name } });

  describe('ledger_account', () => {
    it('accepts an EXPENSE account for a category and a BANK account for a bank, both debit-normal', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          const rent = await category(tx, org);
          const sbi = await bank(tx, org);
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'EXPENSE',
              expenseCategoryId: rent.id,
              normalBalance: 'DEBIT',
            },
          });
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'BANK',
              bankAccountId: sbi.id,
              normalBalance: 'DEBIT',
            },
          });
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'OTHER_INCOME',
              normalBalance: 'CREDIT',
            },
          });
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'OWNER_DRAWINGS',
              normalBalance: 'DEBIT',
            },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects an EXPENSE account with no category, and a category on any other type', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'EXPENSE',
              normalBalance: 'DEBIT',
            },
          });
        }),
      ).rejects.toThrow('ledger_account_expense_category_check');
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          const rent = await category(tx, org);
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'CAPITAL',
              expenseCategoryId: rent.id,
              normalBalance: 'CREDIT',
            },
          });
        }),
      ).rejects.toThrow('ledger_account_expense_category_check');
    });

    it('rejects a BANK account with no bank', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType: 'BANK',
              normalBalance: 'DEBIT',
            },
          });
        }),
      ).rejects.toThrow('ledger_account_bank_account_check');
    });

    it('rejects an expense, bank or drawings account on the credit side, and other income on the debit side', async () => {
      const wrongSide = (
        accountType: 'EXPENSE' | 'BANK' | 'OTHER_INCOME' | 'OWNER_DRAWINGS',
        normalBalance: 'DEBIT' | 'CREDIT',
      ) =>
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          const reference =
            accountType === 'EXPENSE'
              ? { expenseCategoryId: (await category(tx, org)).id }
              : accountType === 'BANK'
                ? { bankAccountId: (await bank(tx, org)).id }
                : {};
          await tx.ledgerAccount.create({
            data: {
              organizationId: org,
              accountType,
              normalBalance,
              ...reference,
            },
          });
        });
      for (const type of ['EXPENSE', 'BANK', 'OWNER_DRAWINGS'] as const) {
        await expect(wrongSide(type, 'CREDIT')).rejects.toThrow(
          'ledger_account_normal_balance_check',
        );
      }
      await expect(wrongSide('OTHER_INCOME', 'DEBIT')).rejects.toThrow(
        'ledger_account_normal_balance_check',
      );
    });

    it('allows one account per category, one per bank, and one other-income account per organization', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          const rent = await category(tx, org);
          for (let i = 0; i < 2; i += 1) {
            await tx.ledgerAccount.create({
              data: {
                organizationId: org,
                accountType: 'EXPENSE',
                expenseCategoryId: rent.id,
                normalBalance: 'DEBIT',
              },
            });
          }
        }),
      ).rejects.toThrow();
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          for (let i = 0; i < 2; i += 1) {
            await tx.ledgerAccount.create({
              data: {
                organizationId: org,
                accountType: 'OTHER_INCOME',
                normalBalance: 'CREDIT',
              },
            });
          }
        }),
      ).rejects.toThrow();
    });

    it("refuses a ledger account keyed to another organization's category or bank", async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const mine = await organization(tx);
          const theirs = await organization(tx);
          const theirRent = await category(tx, theirs);
          await tx.ledgerAccount.create({
            data: {
              organizationId: mine,
              accountType: 'EXPENSE',
              expenseCategoryId: theirRent.id,
              normalBalance: 'DEBIT',
            },
          });
        }),
      ).rejects.toThrow('ledger_account_reference_same_organization');
      await expect(
        withRollback(prisma, async (tx) => {
          const mine = await organization(tx);
          const theirs = await organization(tx);
          const theirBank = await bank(tx, theirs);
          await tx.ledgerAccount.create({
            data: {
              organizationId: mine,
              accountType: 'BANK',
              bankAccountId: theirBank.id,
              normalBalance: 'DEBIT',
            },
          });
        }),
      ).rejects.toThrow('ledger_account_reference_same_organization');
    });
  });

  describe('expense_category and bank_account', () => {
    it('rejects a blank name', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          await category(tx, await organization(tx), '   ');
        }),
      ).rejects.toThrow('expense_category_name_not_blank_check');
      await expect(
        withRollback(prisma, async (tx) => {
          await bank(tx, await organization(tx), '  ');
        }),
      ).rejects.toThrow('bank_account_name_not_blank_check');
    });

    it('allows a name once per organization, whatever its case or spacing, and again in another', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const org = await organization(tx);
          await category(tx, org, 'Fuel & travel');
          await category(tx, org, '  fuel & TRAVEL ');
        }),
      ).rejects.toThrow();
      await expect(
        withRollback(prisma, async (tx) => {
          await category(tx, await organization(tx), 'Fuel & travel');
          await category(tx, await organization(tx), 'Fuel & travel');
        }),
      ).resolves.toBeUndefined();
    });

    it("keeps a bank's last four digits to four digits", async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          await tx.bankAccount.create({
            data: {
              organizationId: await organization(tx),
              name: `SBI ${randomUUID()}`,
              last4: '4321',
            },
          });
        }),
      ).resolves.toBeUndefined();
      await expect(
        withRollback(prisma, async (tx) => {
          await tx.bankAccount.create({
            data: {
              organizationId: await organization(tx),
              name: 'SBI',
              last4: '123456789012',
            },
          });
        }),
      ).rejects.toThrow('bank_account_last4_check');
    });
  });
});
