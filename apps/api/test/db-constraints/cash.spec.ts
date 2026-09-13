import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createUser, decimal } from './fixtures.js';

/**
 * Cash control invariants (M08, BR-16, BR-17), migration `constraints_cash`.
 *
 * The denomination total is a DEFERRED trigger; withRollback forces it to fire
 * before rolling back.
 */
describe('cash constraints (BR-16, BR-17)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function openDay(tx: PrismaClient) {
    const { line } = await createLine(tx);
    return tx.dayClose.create({
      data: {
        lineId: line.id,
        businessDate: new Date('2026-09-02'),
        expectedTotal: decimal('1000.00'),
        collectedTotal: decimal('950.00'),
        cashReceivedTotal: decimal('0.00'),
        discrepancy: decimal('-950.00'),
      },
    });
  }

  async function handover(
    tx: PrismaClient,
    declared: string,
    denominations: { denomination: number; count: number; subtotal?: string }[],
  ) {
    const day = await openDay(tx);
    const from = await createUser(tx);
    const to = await createUser(tx);
    return tx.cashHandover.create({
      data: {
        dayCloseId: day.id,
        fromUserId: from.id,
        toUserId: to.id,
        declaredAmount: decimal(declared),
        systemAmount: decimal('950.00'),
        discrepancy: decimal(declared).minus('950.00'),
        denominations: {
          create: denominations.map((d) => ({
            denomination: d.denomination,
            count: d.count,
            subtotal: decimal(d.subtotal ?? String(d.denomination * d.count)),
          })),
        },
      },
      include: { denominations: true },
    });
  }

  describe('denominations', () => {
    it('accepts ₹950 counted as 1×500, 2×200, 1×50', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          handover(tx, '950.00', [
            { denomination: 500, count: 1 },
            { denomination: 200, count: 2 },
            { denomination: 50, count: 1 },
          ]),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects denominations that do not add up to the declared amount', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          handover(tx, '950.00', [
            { denomination: 500, count: 1 },
            { denomination: 200, count: 2 },
          ]),
        ),
      ).rejects.toThrow(
        /cash_handover_denominations_match: .* declares 950\.00 but denominations total 900\.00/,
      );
    });

    it('rejects a later edit to a denomination count that breaks the total', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const created = await handover(tx, '500.00', [
            { denomination: 500, count: 1 },
          ]);
          await tx.cashDenomination.update({
            where: { id: created.denominations[0]!.id },
            data: { count: 2, subtotal: decimal('1000.00') },
          });
        }),
      ).rejects.toThrow('cash_handover_denominations_match');
    });

    it('rejects a note that does not exist', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          handover(tx, '2000.00', [{ denomination: 2000, count: 1 }]),
        ),
      ).rejects.toThrow('cash_denomination_value_check');
    });

    it('rejects a subtotal that is not denomination × count', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          handover(tx, '500.00', [
            { denomination: 100, count: 4, subtotal: '500.00' },
          ]),
        ),
      ).rejects.toThrow('cash_denomination_subtotal_derivation_check');
    });
  });

  describe('cash_handover', () => {
    it('rejects ACKNOWLEDGED without an acknowledgement time (BR-17)', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const created = await handover(tx, '500.00', [
            { denomination: 500, count: 1 },
          ]);
          await tx.cashHandover.update({
            where: { id: created.id },
            data: { status: 'ACKNOWLEDGED' },
          });
        }),
      ).rejects.toThrow('cash_handover_acknowledged_at_check');
    });

    it('rejects a discrepancy that is not declared − system', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const created = await handover(tx, '500.00', [
            { denomination: 500, count: 1 },
          ]);
          await tx.cashHandover.update({
            where: { id: created.id },
            data: { discrepancy: decimal('0.00') },
          });
        }),
      ).rejects.toThrow('cash_handover_discrepancy_derivation_check');
    });

    it('rejects a handover to oneself', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const day = await openDay(tx);
          const user = await createUser(tx);
          await tx.cashHandover.create({
            data: {
              dayCloseId: day.id,
              fromUserId: user.id,
              toUserId: user.id,
              declaredAmount: decimal('0.00'),
              systemAmount: decimal('0.00'),
              discrepancy: decimal('0.00'),
            },
          });
        }),
      ).rejects.toThrow('cash_handover_distinct_parties_check');
    });
  });

  describe('day_close', () => {
    it('rejects TALLIED with a discrepancy', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const day = await openDay(tx);
          await tx.dayClose.update({
            where: { id: day.id },
            data: { status: 'TALLIED', closedAt: new Date() },
          });
        }),
      ).rejects.toThrow('day_close_tallied_zero_discrepancy_check');
    });

    it('accepts TALLIED once cash received matches collected', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const day = await openDay(tx);
          await tx.dayClose.update({
            where: { id: day.id },
            data: {
              status: 'TALLIED',
              closedAt: new Date(),
              cashReceivedTotal: decimal('950.00'),
              discrepancy: decimal('0.00'),
            },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects CLOSED without a close time', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const day = await openDay(tx);
          await tx.dayClose.update({
            where: { id: day.id },
            data: { status: 'CLOSED' },
          });
        }),
      ).rejects.toThrow('day_close_closed_has_timestamp_check');
    });
  });
});
