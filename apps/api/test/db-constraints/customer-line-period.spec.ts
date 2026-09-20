import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createActiveAccount, createLine } from './fixtures.js';

/**
 * Temporal line membership invariants (M04, US-023, BR-15), migrations
 * `customer_line_period` and `constraints_customer_line_period`.
 */
describe('customer_line_period constraints (M04)', () => {
  let prisma: PrismaClient;

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const period = (
    tx: PrismaClient,
    customerId: string,
    lineId: string,
    dates: { effectiveFrom?: Date; effectiveTo?: Date | null } = {},
  ) =>
    tx.customerLinePeriod.create({
      data: {
        customerId,
        lineId,
        effectiveFrom: new Date('2026-09-01'),
        effectiveTo: null,
        ...dates,
      },
    });

  it('rejects a second current line for the same customer', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        // createActiveAccount already leaves one open period, as onboarding
        // does; a second open one is the thing being refused.
        const { customer, line } = await createActiveAccount(tx);
        await period(tx, customer.id, line.id);
      }),
    ).rejects.toThrow(
      /Unique constraint failed on the (fields: \(`customerId`\)|constraint: `customer_line_period_current_key`)/,
    );
  });

  it('accepts the next line once the previous period has ended', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization, sector, customer } =
          await createActiveAccount(tx);
        const next = await tx.line.create({
          data: {
            organizationId: organization.id,
            sectorId: sector.id,
            code: `L-next-${customer.id}`,
            name: 'Next line',
          },
        });
        await tx.customerLinePeriod.updateMany({
          where: { customerId: customer.id, effectiveTo: null },
          data: { effectiveTo: new Date('2026-09-20') },
        });
        await period(tx, customer.id, next.id, {
          effectiveFrom: new Date('2026-09-20'),
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a period that ends before it starts', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { customer, line } = await createActiveAccount(tx);
        await period(tx, customer.id, line.id, {
          effectiveFrom: new Date('2026-09-20'),
          effectiveTo: new Date('2026-09-19'),
        });
      }),
    ).rejects.toThrow(/customer_line_period_effective_range_check/);
  });

  it('a period cannot name a line that does not exist', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { customer } = await createActiveAccount(tx);
        // Closed, so the open-period index is not what refuses it.
        await period(tx, customer.id, 'no-such-line', {
          effectiveTo: new Date('2026-09-30'),
        });
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it('deleting a customer takes their periods with them', async () => {
    await withRollback(prisma, async (tx) => {
      const { organization, sector } = await createLine(tx);
      const line = await tx.line.create({
        data: {
          organizationId: organization.id,
          sectorId: sector.id,
          code: `L-del-${organization.id}`,
          name: 'Line',
        },
      });
      const customer = await tx.customer.create({
        data: {
          organizationId: organization.id,
          customerCode: `C-del-${organization.id}`,
          name: 'Customer',
          mobile: '+919800000000',
          address: 'Address',
          sectorId: sector.id,
          lineId: line.id,
        },
      });
      await period(tx, customer.id, line.id);

      expect(
        await tx.customerLinePeriod.count({
          where: { customerId: customer.id },
        }),
      ).toBe(1);
      await tx.customer.delete({ where: { id: customer.id } });

      expect(
        await tx.customerLinePeriod.count({
          where: { customerId: customer.id },
        }),
      ).toBe(0);
    });
  });
});
