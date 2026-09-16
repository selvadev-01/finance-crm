import type { PrismaClient } from '@repo/db';
import { toMoney } from '@repo/domain';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { at, cashWorld, counts, MONDAY } from './world.js';

/**
 * Cash handovers (M08, US-061…US-064, BR-17) against real rows, rolled back.
 * Acknowledgement posts to the ledger, which rejects DELETE, so this tier is
 * where it is proven.
 *
 * The Junior collects ₹4,320 on Monday 5 January: accounts expecting 1,500,
 * 1,500 and 1,320.
 */
describe('HandoverService (US-061, US-062, US-063, US-064)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const evening = at('2026-01-05', '19:30:00');
  /** ₹4,320: 8×500, 1×200, 1×100, 1×20. */
  const exact = counts({ 500: 8, 200: 1, 100: 1, 20: 1 });
  /** ₹4,300: one ₹20 note short. */
  const short = counts({ 500: 8, 200: 1, 100: 1 });

  async function collected(w: Awaited<ReturnType<typeof cashWorld>>) {
    for (const daily of ['1500', '1500', '1320']) {
      const account = await w.account(daily);
      await w.collect(account.id, daily);
    }
  }

  it('Scenario: Junior hands cash to Senior — counts per denomination, the total computed from them, compared with the recorded 4,320', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);

      const position = await w.handovers.position(w.junior, evening);
      expect(position.items).toEqual([
        expect.objectContaining({
          lineId: w.line.id,
          businessDate: '2026-01-05',
          hop: 'JUNIOR_TO_SENIOR',
          toHandOver: '4320.00',
          receiver: { userId: w.senior.userId, name: expect.any(String) },
          pending: null,
        }),
      ]);

      const handover = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: exact },
        evening,
      );
      expect(handover).toMatchObject({
        hop: 'JUNIOR_TO_SENIOR',
        toUserId: w.senior.userId,
        declaredAmount: '4320.00',
        systemAmount: '4320.00',
        discrepancy: '0.00',
        status: 'PENDING',
      });
      expect(handover.denominations).toHaveLength(9);
      expect(
        handover.denominations.find((d) => d.denomination === 500),
      ).toEqual({
        denomination: 500,
        count: 8,
        subtotal: '4000.00',
      });
      // Cash has not moved until acknowledged (BR-17).
      expect((await w.cash(w.junior.userId)).own).toBe('4320.00');
    });
  });

  it('Scenario: discrepancy is recorded, not blocked — 4,300 against 4,320 is −20, flagged, with a note', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);

      await expect(
        w.handovers.handOver(
          w.junior,
          { lineId: w.line.id, businessDate: MONDAY, counts: short },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'NOTE_REQUIRED', status: 422 });

      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: short,
          note: 'One ₹20 note given as change',
        },
        evening,
      );
      expect(handover).toMatchObject({
        declaredAmount: '4300.00',
        systemAmount: '4320.00',
        discrepancy: '-20.00',
        status: 'PENDING',
      });

      const senior = await w.handovers.list(w.senior);
      expect(senior.data).toEqual([
        expect.objectContaining({
          id: handover.id,
          discrepancy: '-20.00',
          canAcknowledge: true,
          canDispute: true,
        }),
      ]);
      await expect(
        w.handovers.handOver(
          w.junior,
          { lineId: w.line.id, businessDate: MONDAY, counts: exact },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'HANDOVER_PENDING', status: 409 });
    });
  });

  it('US-062: acknowledging moves the cash — the ledger posts what was counted, only the receiver can, and only once; the short ₹20 stays with the Junior', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);
      const { id } = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: short,
          note: 'One note short',
        },
        evening,
      );

      await expect(
        w.handovers.acknowledge(w.admin, id, evening),
      ).rejects.toMatchObject({
        code: 'NOT_THE_RECEIVER',
        status: 403,
      });
      const acknowledged = await w.handovers.acknowledge(w.senior, id, evening);
      expect(acknowledged).toMatchObject({
        status: 'ACKNOWLEDGED',
        acknowledgedAt: expect.any(String),
        canAcknowledge: false,
      });

      expect((await w.cash(w.junior.userId)).own).toBe('20.00');
      expect((await w.cash(w.senior.userId)).own).toBe('4300.00');
      const posting = await tx.ledgerTransaction.findFirstOrThrow({
        where: { sourceTable: 'cash_handover', sourceId: id },
      });
      expect(posting.transactionType).toBe('HANDOVER');

      const day = await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening);
      expect(day).toMatchObject({
        cashReceivedTotal: '4300.00',
        discrepancy: '-20.00',
      });

      await expect(
        w.handovers.acknowledge(w.senior, id, evening),
      ).rejects.toMatchObject({
        code: 'HANDOVER_NOT_PENDING',
        status: 409,
      });
      await expect(
        w.handovers.dispute(w.junior, id, 'Too late'),
      ).rejects.toMatchObject({ code: 'HANDOVER_NOT_PENDING' });
    });
  });

  it('BR-16: a closed day tallies once the cash received matches with nothing pending', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);
      await w.synced();
      await w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening);
      const { id } = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: exact },
        evening,
      );
      expect(
        (await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening)).status,
      ).toBe('CLOSED');

      await w.handovers.acknowledge(w.senior, id, evening);
      expect(
        await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening),
      ).toMatchObject({
        status: 'TALLIED',
        cashReceivedTotal: '4320.00',
        discrepancy: '0.00',
      });
    });
  });

  it("US-064: the Senior hands the day's cash to an Admin they choose; acknowledgement lands it in CASH_AT_OFFICE", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);
      const first = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: exact },
        evening,
      );
      await w.handovers.acknowledge(w.senior, first.id, evening);

      const position = await w.handovers.position(w.senior, evening);
      expect(position.items).toEqual([
        expect.objectContaining({
          hop: 'SENIOR_TO_OFFICE',
          toHandOver: '4320.00',
          receiver: null,
        }),
      ]);
      expect(position.officeReceivers.map((r) => r.userId)).toEqual([
        w.admin.userId,
      ]);

      await expect(
        w.handovers.handOver(
          w.senior,
          {
            lineId: w.line.id,
            businessDate: MONDAY,
            counts: exact,
            toUserId: w.junior.userId,
          },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'RECEIVER_NOT_ADMIN', status: 422 });
      await expect(
        w.handovers.handOver(
          w.otherSenior,
          {
            lineId: w.line.id,
            businessDate: MONDAY,
            counts: exact,
            toUserId: w.admin.userId,
          },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });

      const office = (await w.cash(w.senior.userId)).office;
      const second = await w.handovers.handOver(
        w.senior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: exact,
          toUserId: w.admin.userId,
        },
        evening,
      );
      expect(second).toMatchObject({
        hop: 'SENIOR_TO_OFFICE',
        systemAmount: '4320.00',
        discrepancy: '0.00',
      });
      await w.handovers.acknowledge(w.admin, second.id, evening);

      const after = await w.cash(w.senior.userId);
      expect(after.own).toBe('0.00');
      expect(after.office).toBe(toMoney(office).plus('4320').toFixed(2));
      const moved = await tx.ledgerEntry.findFirstOrThrow({
        where: {
          ledgerTransaction: { sourceId: second.id },
          direction: 'DEBIT',
        },
        include: { ledgerAccount: true },
      });
      expect(moved).toMatchObject({
        ledgerAccount: { accountType: 'CASH_AT_OFFICE' },
      });
      expect(moved.amount.toFixed(2)).toBe('4320.00');
      // The office hop does not count twice towards the line's cash received.
      expect(
        (await w.dayCloses.view(w.admin, w.line.id, MONDAY, evening))
          .cashReceivedTotal,
      ).toBe('4320.00');
    });
  });

  it('US-063: either party disputes a pending handover with a note; nothing moves, and the sender counts again', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);
      const disputed = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: short,
          note: 'Short',
        },
        evening,
      );

      await expect(
        w.handovers.dispute(w.otherSenior, disputed.id, 'Not mine'),
      ).rejects.toMatchObject({ status: 404 });
      const result = await w.handovers.dispute(
        w.senior,
        disputed.id,
        'Counted 4,280 here, not 4,300',
      );
      expect(result).toMatchObject({
        status: 'DISPUTED',
        disputeNote: 'Counted 4,280 here, not 4,300',
        canAcknowledge: false,
      });
      expect(
        await tx.ledgerTransaction.count({
          where: { sourceTable: 'cash_handover', sourceId: disputed.id },
        }),
      ).toBe(0);
      expect((await w.cash(w.junior.userId)).own).toBe('4320.00');

      const recount = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: exact },
        evening,
      );
      expect(recount).toMatchObject({
        status: 'PENDING',
        systemAmount: '4320.00',
      });
    });
  });

  it('a late collection after an acknowledged handover is handed over separately; with no Senior on the line a Junior cannot hand over', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await collected(w);
      const first = await w.handovers.handOver(
        w.junior,
        { lineId: w.line.id, businessDate: MONDAY, counts: exact },
        evening,
      );
      await w.handovers.acknowledge(w.senior, first.id, evening);
      const extra = await w.account('100');
      await w.collect(extra.id, '100');

      const position = await w.handovers.position(
        w.junior,
        at('2026-01-05', '21:00:00'),
      );
      expect(position.items).toEqual([
        expect.objectContaining({ toHandOver: '100.00' }),
      ]);

      // Cash for a line and day the Junior recorded nothing on is refused,
      // even counted and explained: it would move money with nothing behind it.
      await expect(
        w.handovers.handOver(
          w.junior,
          {
            lineId: w.otherLine.id,
            businessDate: MONDAY,
            counts: counts({ 500: 1 }),
            note: 'Found in my bag',
          },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'NOTHING_TO_HAND_OVER', status: 422 });

      await tx.lineAssignment.updateMany({
        where: { lineId: w.line.id, assignmentRole: 'SENIOR' },
        data: { effectiveTo: new Date('2026-01-04') },
      });
      await expect(
        w.handovers.handOver(
          w.junior,
          {
            lineId: w.line.id,
            businessDate: MONDAY,
            counts: counts({ 100: 1 }),
          },
          evening,
        ),
      ).rejects.toMatchObject({ code: 'NO_SENIOR_ON_LINE', status: 422 });
    });
  });
});
