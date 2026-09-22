import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createActiveAccount } from './fixtures.js';

/**
 * A customer's place on its line's visiting order (US-040), migrations
 * `customer_route_position` and `constraints_customer_route_position`.
 */
describe('customer.routePosition constraints (US-040)', () => {
  let prisma: PrismaClient;

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuses a place below 1', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { customer } = await createActiveAccount(tx);
        await tx.customer.update({
          where: { id: customer.id },
          data: { routePosition: 0 },
        });
      }),
    ).rejects.toThrow(/customer_route_position_check/);
  });

  it('refuses two customers in one place on the same line', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { customer } = await createActiveAccount(tx);
        await tx.customer.update({
          where: { id: customer.id },
          data: { routePosition: 1 },
        });
        const { id: _id, customerCode, ...rest } = customer;
        await tx.customer.create({
          data: {
            ...rest,
            customerCode: `${customerCode}-2`,
            routePosition: 1,
          },
        });
      }),
    ).rejects.toThrow(
      /Unique constraint failed on the (fields: \(`lineId`,`routePosition`\)|constraint: `customer_line_route_position_key`)/,
    );
  });

  it('lets any number of customers wait unplaced', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { customer } = await createActiveAccount(tx);
        const { id: _id, customerCode, ...rest } = customer;
        await tx.customer.create({
          data: { ...rest, customerCode: `${customerCode}-2` },
        });
      }),
    ).resolves.toBeUndefined();
  });
});
