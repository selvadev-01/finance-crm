import { Prisma, type PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Ledger invariants (BR-18, ADR-0006), enforced by migration
 * `constraints_ledger`.
 *
 * The balancing trigger is DEFERRED, so it fires at COMMIT. withRollback runs
 * `SET CONSTRAINTS ALL IMMEDIATE` before rolling back, which is the only reason
 * the rejection cases here can fail at all.
 */
describe('ledger constraints (BR-18, ADR-0006)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  type Posting = {
    account: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: string;
  };

  const createOrganization = (tx: PrismaClient) =>
    tx.organization.create({
      data: { name: 'Ledger Probe', timezone: 'Asia/Kolkata', currency: 'INR' },
    });

  async function createLedgerAccounts(tx: PrismaClient) {
    const { id: organizationId } = await createOrganization(tx);
    const create = (
      accountType:
        'CASH_AT_OFFICE' | 'CAPITAL' | 'UNEARNED_PROFIT' | 'EARNED_PROFIT',
      normalBalance: 'DEBIT' | 'CREDIT',
    ) =>
      tx.ledgerAccount.create({
        data: { organizationId, accountType, normalBalance },
      });

    return {
      cash: await create('CASH_AT_OFFICE', 'DEBIT'),
      capital: await create('CAPITAL', 'CREDIT'),
      unearned: await create('UNEARNED_PROFIT', 'CREDIT'),
      earned: await create('EARNED_PROFIT', 'CREDIT'),
    };
  }

  async function post(tx: PrismaClient, postings: Posting[]) {
    return tx.ledgerTransaction.create({
      data: {
        transactionType: 'COLLECTION',
        sourceTable: 'collection',
        sourceId: 'test-source',
        businessDate: new Date('2026-09-13'),
        eventAt: new Date('2026-09-13T04:30:00Z'),
        description: 'Test posting',
        entries: {
          create: postings.map((p, index) => ({
            ledgerAccountId: p.account,
            direction: p.direction,
            amount: new Prisma.Decimal(p.amount),
            sequence: index + 1,
          })),
        },
      },
      include: { entries: true },
    });
  }

  // BR-18 worked example: ₹100 collected on the reference account recognises
  // 15% (₹15) of profit.
  function referenceCollection(
    accounts: Awaited<ReturnType<typeof createLedgerAccounts>>,
  ): Posting[] {
    return [
      { account: accounts.cash.id, direction: 'DEBIT', amount: '100.00' },
      { account: accounts.capital.id, direction: 'CREDIT', amount: '100.00' },
      { account: accounts.unearned.id, direction: 'DEBIT', amount: '15.00' },
      { account: accounts.earned.id, direction: 'CREDIT', amount: '15.00' },
    ];
  }

  it('accepts a balanced four-entry posting', async () => {
    // Also proves the trigger reads the schema it was migrated into: had it
    // resolved ledger_entry against `public`, it would count zero entries here
    // and reject a correct posting.
    const transaction = await withRollback(prisma, async (tx) => {
      const accounts = await createLedgerAccounts(tx);
      return post(tx, referenceCollection(accounts));
    });

    expect(transaction.entries).toHaveLength(4);
  });

  it('accepts entries that only balance once the last one is written', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const accounts = await createLedgerAccounts(tx);
        const transaction = await post(tx, [
          { account: accounts.cash.id, direction: 'DEBIT', amount: '100.00' },
        ]);
        // Unbalanced here — legal, because the check is deferred to commit.
        await tx.ledgerEntry.create({
          data: {
            ledgerTransactionId: transaction.id,
            ledgerAccountId: accounts.capital.id,
            direction: 'CREDIT',
            amount: new Prisma.Decimal('100.00'),
            sequence: 2,
          },
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a posting whose debits and credits differ by one paisa', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const accounts = await createLedgerAccounts(tx);
        await post(tx, [
          { account: accounts.cash.id, direction: 'DEBIT', amount: '100.00' },
          {
            account: accounts.capital.id,
            direction: 'CREDIT',
            amount: '99.99',
          },
        ]);
      }),
    ).rejects.toThrow(
      /ledger_transaction_balanced: .* debits 100\.00 <> credits 99\.99/,
    );
  });

  it('rejects a transaction with a single entry', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const accounts = await createLedgerAccounts(tx);
        await post(tx, [
          { account: accounts.cash.id, direction: 'DEBIT', amount: '100.00' },
        ]);
      }),
    ).rejects.toThrow(/ledger_transaction_balanced: .* has 1 entries/);
  });

  it('rejects a transaction with no entries', async () => {
    await expect(withRollback(prisma, (tx) => post(tx, []))).rejects.toThrow(
      /ledger_transaction_balanced: .* has 0 entries/,
    );
  });

  it.each(['0.00', '-100.00'])(
    'rejects an entry amount of %s',
    async (amount) => {
      await expect(
        withRollback(prisma, async (tx) => {
          const accounts = await createLedgerAccounts(tx);
          await post(tx, [
            { account: accounts.cash.id, direction: 'DEBIT', amount },
            { account: accounts.capital.id, direction: 'CREDIT', amount },
          ]);
        }),
      ).rejects.toThrow('ledger_entry_amount_positive_check');
    },
  );

  describe('ledger_account shape', () => {
    it('rejects CASH_IN_HAND with no owning staff member', async () => {
      await expect(
        withRollback(prisma, async (tx) =>
          tx.ledgerAccount.create({
            data: {
              organizationId: (await createOrganization(tx)).id,
              accountType: 'CASH_IN_HAND',
              normalBalance: 'DEBIT',
            },
          }),
        ),
      ).rejects.toThrow('ledger_account_owner_matches_type_check');
    });

    it('rejects a credit-normal cash account', async () => {
      await expect(
        withRollback(prisma, async (tx) =>
          tx.ledgerAccount.create({
            data: {
              organizationId: (await createOrganization(tx)).id,
              accountType: 'CASH_AT_OFFICE',
              normalBalance: 'CREDIT',
            },
          }),
        ),
      ).rejects.toThrow('ledger_account_normal_balance_check');
    });

    it('rejects a second CASH_IN_HAND account for the same staff member', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const data = {
            organizationId: (await createOrganization(tx)).id,
            accountType: 'CASH_IN_HAND' as const,
            normalBalance: 'DEBIT' as const,
            ownerUserId: 'staff-user-1',
          };
          await tx.ledgerAccount.create({ data });
          await tx.ledgerAccount.create({ data });
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`ownerUserId`\)|constraint: `ledger_account_cash_in_hand_owner_key`)/,
      );
    });

    it('allows one of each business-wide account per organization, and one more in another organization', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const first = await createOrganization(tx);
          const second = await createOrganization(tx);
          const office = (organizationId: string) =>
            tx.ledgerAccount.create({
              data: {
                organizationId,
                accountType: 'CASH_AT_OFFICE',
                normalBalance: 'DEBIT',
              },
            });
          await office(first.id);
          await office(second.id);
          await office(first.id);
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`organizationId`,`accountType`\)|constraint: `ledger_account_organization_singleton_key`)/,
      );
    });
  });

  describe('append-only', () => {
    it('rejects updating an entry', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const accounts = await createLedgerAccounts(tx);
          const transaction = await post(tx, referenceCollection(accounts));
          await tx.ledgerEntry.update({
            where: { id: transaction.entries[0]!.id },
            data: { amount: new Prisma.Decimal('90.00') },
          });
        }),
      ).rejects.toThrow('ledger_append_only: UPDATE on ledger_entry');
    });

    it('rejects deleting an entry', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const accounts = await createLedgerAccounts(tx);
          const transaction = await post(tx, referenceCollection(accounts));
          await tx.ledgerEntry.delete({
            where: { id: transaction.entries[0]!.id },
          });
        }),
      ).rejects.toThrow('ledger_append_only: DELETE on ledger_entry');
    });

    it('rejects updating a transaction', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const accounts = await createLedgerAccounts(tx);
          const transaction = await post(tx, referenceCollection(accounts));
          await tx.ledgerTransaction.update({
            where: { id: transaction.id },
            data: { description: 'Rewritten' },
          });
        }),
      ).rejects.toThrow('ledger_append_only: UPDATE on ledger_transaction');
    });

    it('still allows the balance cache on ledger_account to be rebuilt', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const accounts = await createLedgerAccounts(tx);
          await post(tx, referenceCollection(accounts));
          await tx.ledgerAccount.update({
            where: { id: accounts.cash.id },
            data: { balance: new Prisma.Decimal('100.00') },
          });
        }),
      ).resolves.toBeUndefined();
    });
  });
});
