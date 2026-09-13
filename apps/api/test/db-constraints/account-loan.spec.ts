import { Prisma, type PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * BR-01 invariants on account_loan, enforced by CHECK constraints in migration
 * `constraints_account_loan`. Each case writes directly through Prisma — no
 * service in between — because the point is that the database refuses the row
 * even when application validation is bypassed.
 */
describe('account_loan constraints (BR-01)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // PDF reference example: A 10,000 / I 8,500 / P 1,500 / D 100 / N 100.
  const referenceAccount = {
    accountAmount: '10000.00',
    investedAmount: '8500.00',
    profitAmount: '1500.00',
    dailyAmount: '100.00',
    termDays: 100,
    collectedAmount: '0.00',
  };

  async function insertAccount(
    tx: PrismaClient,
    overrides: Partial<typeof referenceAccount>,
  ) {
    const suffix = randomUUID();
    const organization = await tx.organization.create({
      data: { name: 'Rasi Test', timezone: 'Asia/Kolkata', currency: 'INR' },
    });
    const sector = await tx.sector.create({
      data: {
        organizationId: organization.id,
        code: `S-${suffix}`,
        name: 'Sector',
      },
    });
    const line = await tx.line.create({
      data: {
        organizationId: organization.id,
        sectorId: sector.id,
        code: `L-${suffix}`,
        name: 'Line',
      },
    });
    const customer = await tx.customer.create({
      data: {
        organizationId: organization.id,
        customerCode: `C-${suffix}`,
        name: 'Customer',
        mobile: '+919800000000',
        address: 'Address',
        sectorId: sector.id,
        lineId: line.id,
      },
    });

    const amounts = { ...referenceAccount, ...overrides };
    return tx.accountLoan.create({
      data: {
        organizationId: organization.id,
        accountCode: `A-${suffix}`,
        customerId: customer.id,
        lineId: line.id,
        accountAmount: new Prisma.Decimal(amounts.accountAmount),
        investedAmount: new Prisma.Decimal(amounts.investedAmount),
        profitAmount: new Prisma.Decimal(amounts.profitAmount),
        dailyAmount: new Prisma.Decimal(amounts.dailyAmount),
        termDays: amounts.termDays,
        collectedAmount: new Prisma.Decimal(amounts.collectedAmount),
        outstandingAmount: new Prisma.Decimal(amounts.accountAmount),
        disbursementDate: new Date('2026-09-01'),
        firstCollectionDate: new Date('2026-09-02'),
        targetCompletionDate: new Date('2026-12-10'),
      },
    });
  }

  function expectRejectedBy(
    constraint: string | RegExp,
    overrides: Partial<typeof referenceAccount>,
  ) {
    return expect(
      withRollback(prisma, (tx) => insertAccount(tx, overrides)),
    ).rejects.toThrow(constraint);
  }

  it('accepts the reference example, an exact fit of D × N = A', async () => {
    const account = await withRollback(prisma, (tx) => insertAccount(tx, {}));
    expect(account.profitAmount.toString()).toBe('1500');
  });

  it('accepts an uneven schedule where D × N exceeds A', async () => {
    // BR-04 uneven example: 150 × 100 = 15,000 ≥ 10,000.
    await expect(
      withRollback(prisma, (tx) =>
        insertAccount(tx, { dailyAmount: '150.00' }),
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    [
      'investedAmount',
      'account_loan_invested_amount_positive_check',
      { investedAmount: '0.00', profitAmount: '10000.00' },
    ],
    [
      'dailyAmount',
      'account_loan_daily_amount_positive_check',
      { dailyAmount: '0.00' },
    ],
  ] as const)(
    'rejects a non-positive %s',
    async (_field, constraint, overrides) => {
      await expectRejectedBy(constraint, overrides);
    },
  );

  // A > 0 and N > 0 cannot be violated alone: 0 < I < A already forces A > 0,
  // and D × N ≥ A > 0 already forces N > 0. Postgres reports whichever check it
  // evaluates first, so these accept any of the constraints the row breaks.
  it('rejects a zero account amount', async () => {
    await expectRejectedBy(
      /account_loan_(account_amount_positive|invested_below_account|daily_within_account|term_clears_account)_check/,
      { accountAmount: '0.00', investedAmount: '1.00', profitAmount: '-1.00' },
    );
  });

  it('rejects a zero term', async () => {
    await expectRejectedBy(
      /account_loan_(term_days_positive|term_clears_account)_check/,
      { termDays: 0 },
    );
  });

  it('rejects an invested amount equal to the account amount, which leaves no profit', async () => {
    await expectRejectedBy('account_loan_invested_below_account_check', {
      investedAmount: '10000.00',
      profitAmount: '0.00',
    });
  });

  it('rejects a profit amount that disagrees with A − I', async () => {
    await expectRejectedBy('account_loan_profit_derivation_check', {
      profitAmount: '1500.01',
    });
  });

  it('rejects a daily amount larger than the whole account', async () => {
    await expectRejectedBy('account_loan_daily_within_account_check', {
      dailyAmount: '10000.01',
    });
  });

  it('rejects a term that cannot clear the account', async () => {
    // 100 × 99 = 9,900 < 10,000.
    await expectRejectedBy('account_loan_term_clears_account_check', {
      termDays: 99,
    });
  });

  it('rejects a negative collected amount', async () => {
    await expectRejectedBy('account_loan_collected_non_negative_check', {
      collectedAmount: '-0.01',
    });
  });
});
