import type { PrismaClient } from '@repo/db';
import type { PinoLogger } from 'nestjs-pino';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { BooksMoneyService } from '../../src/books/books-money.service.js';
import { FieldExpenseService } from '../../src/books/field-expense.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { DiscrepancyReportService } from '../../src/reports/discrepancy-report.service.js';
import { at, cashWorld, counts, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Books slice 3 (ADR-0018), rolled back: a field expense paid from collected
 * cash waits for someone else's approval; approved, it posts against the
 * spender's cash in hand, lowers what they hand over, and the line's day and
 * the discrepancy report count it as spent, not missing.
 */
describe('field expenses (ADR-0018)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const evening = at('2026-01-05', '18:00:00');

  async function world(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    const ledger = new LedgerService(database);
    const money = new BooksMoneyService(database, audit, ledger);
    const field = new FieldExpenseService(
      database,
      audit,
      ledger,
      money,
      w.dayCloses,
      w.notices,
    );
    const fuel = await tx.expenseCategory.create({
      data: { organizationId: w.organizationId, name: 'Fuel & travel' },
    });
    const account = await w.account('1000');
    await w.collect(account.id, '1000');
    const report = new DiscrepancyReportService(database, {
      warn: () => undefined,
      error: () => undefined,
    } as unknown as PinoLogger);
    const petrol = (who: RequestContext, amount = '50') =>
      field.request(
        who,
        { categoryId: fuel.id, amount, note: 'Petrol for the round' },
        MONDAY,
      );
    return { ...w, money, field, fuel, report, petrol };
  }

  it('worked example: ₹1,000 collected, ₹50 petrol approved — the Junior owes ₹950, the expense is ₹50 and the day tallies', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);

      const asked = await w.petrol(w.junior);
      expect(asked).toMatchObject({
        status: 'PENDING',
        paidFrom: 'CASH_IN_HAND',
        amount: '50.00',
        spender: { userId: w.junior.userId },
        line: { id: w.line.id },
        canDecide: false,
      });
      // Pending posts nothing and lowers nothing.
      expect((await w.cash(w.junior.userId)).own).toBe('1000.00');
      expect((await w.handovers.position(w.junior, evening)).items).toEqual([
        expect.objectContaining({ toHandOver: '1000.00', expenses: '0.00' }),
      ]);
      expect((await w.money.getExpense(w.senior, asked.id)).canDecide).toBe(
        true,
      );

      const approved = await w.field.decide(
        w.senior,
        asked.id,
        { decision: 'APPROVED' },
        evening,
      );
      expect(approved).toMatchObject({
        status: 'APPROVED',
        decidedBy: { userId: w.senior.userId },
        canDecide: false,
      });
      expect((await w.cash(w.junior.userId)).own).toBe('950.00');
      const posting = await tx.ledgerTransaction.findFirstOrThrow({
        where: { sourceTable: 'expense', sourceId: asked.id },
        include: { entries: { include: { ledgerAccount: true } } },
      });
      expect(posting.transactionType).toBe('EXPENSE');
      expect(
        posting.entries
          .map((entry) => [
            entry.ledgerAccount.accountType,
            entry.direction,
            entry.amount.toFixed(2),
          ])
          .sort(),
      ).toEqual([
        ['CASH_IN_HAND', 'CREDIT', '50.00'],
        ['EXPENSE', 'DEBIT', '50.00'],
      ]);

      expect((await w.handovers.position(w.junior, evening)).items).toEqual([
        expect.objectContaining({ toHandOver: '950.00', expenses: '50.00' }),
      ]);
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 500: 1, 200: 2, 50: 1 }),
        },
        evening,
      );
      expect(handover).toMatchObject({
        systemAmount: '950.00',
        discrepancy: '0.00',
      });
      await w.handovers.acknowledge(w.senior, handover.id, evening);
      await w.synced();
      await w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening);

      expect(
        await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening),
      ).toMatchObject({
        status: 'TALLIED',
        collectedTotal: '1000.00',
        cashReceivedTotal: '950.00',
        expenseTotal: '50.00',
        discrepancy: '0.00',
      });
      expect((await w.cash(w.junior.userId)).own).toBe('0.00');

      const report = await w.report.view(
        w.admin,
        { from: MONDAY, to: MONDAY, limit: 50, show: 'all' },
        evening,
      );
      expect(report.data).toEqual([
        expect.objectContaining({
          collected: '1000.00',
          cash: expect.objectContaining({
            handedOver: '950.00',
            expenses: '50.00',
            difference: '0.00',
            state: 'TALLIED',
          }),
        }),
      ]);
      expect(report.summary.cash).toMatchObject({
        expenses: '50.00',
        net: '0.00',
      });
    });
  });

  it('approving after the day closed short re-tallies it, without reopening it', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const asked = await w.petrol(w.junior);
      // Counted before anyone approved: ₹50 short against ₹1,000.
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 500: 1, 200: 2, 50: 1 }),
          note: 'Spent ₹50 on petrol',
        },
        evening,
      );
      await w.handovers.acknowledge(w.senior, handover.id, evening);
      await w.synced();
      await w.dayCloses.close(w.senior, w.line.id, MONDAY, false, evening);
      expect(
        await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening),
      ).toMatchObject({ status: 'CLOSED', discrepancy: '-50.00' });

      await w.field.decide(
        w.admin,
        asked.id,
        { decision: 'APPROVED' },
        evening,
      );
      expect(
        await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening),
      ).toMatchObject({
        status: 'TALLIED',
        expenseTotal: '50.00',
        discrepancy: '0.00',
      });
      const stored = await tx.dayClose.findFirstOrThrow({
        where: { lineId: w.line.id },
      });
      expect(stored.expenseTotal.toFixed(2)).toBe('50.00');
    });
  });

  it('a rejection posts nothing and the cash is still owed; a decision is made once', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const asked = await w.petrol(w.junior);
      const rejected = await w.field.decide(
        w.senior,
        asked.id,
        { decision: 'REJECTED', note: 'Petrol is paid weekly' },
        evening,
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Petrol is paid weekly',
      });
      expect(
        await tx.ledgerTransaction.count({
          where: { sourceTable: 'expense', sourceId: asked.id },
        }),
      ).toBe(0);
      expect((await w.handovers.position(w.junior, evening)).items).toEqual([
        expect.objectContaining({ toHandOver: '1000.00', expenses: '0.00' }),
      ]);
      await expect(
        w.field.decide(w.admin, asked.id, { decision: 'APPROVED' }, evening),
      ).rejects.toMatchObject({ code: 'EXPENSE_ALREADY_DECIDED', status: 409 });
    });
  });

  it('worked example: a spender holding ₹40 cannot have ₹50 approved, and nothing posts — but it can still be rejected', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      // The Junior collected ₹1,000 and handed ₹960 on, so holds ₹40.
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 500: 1, 200: 2, 50: 1, 10: 1 }),
          note: 'Kept ₹40 for petrol',
        },
        evening,
      );
      await w.handovers.acknowledge(w.senior, handover.id, evening);
      expect((await w.cash(w.junior.userId)).own).toBe('40.00');

      const asked = await w.petrol(w.junior);
      await expect(
        w.field.decide(w.senior, asked.id, { decision: 'APPROVED' }, evening),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_CASH_IN_HAND',
        status: 422,
      });
      expect(
        await tx.ledgerTransaction.count({
          where: { sourceTable: 'expense', sourceId: asked.id },
        }),
      ).toBe(0);
      expect((await w.cash(w.junior.userId)).own).toBe('40.00');

      // ₹40 is enough for ₹40, and holding nothing is no bar to a rejection.
      const smaller = await w.petrol(w.junior, '40');
      await w.field.decide(
        w.senior,
        smaller.id,
        { decision: 'APPROVED' },
        evening,
      );
      expect((await w.cash(w.junior.userId)).own).toBe('0.00');
      expect(
        await w.field.decide(
          w.senior,
          asked.id,
          { decision: 'REJECTED' },
          evening,
        ),
      ).toMatchObject({ status: 'REJECTED' });
    });
  });

  it("nobody decides their own; a Senior's own goes to an Admin and comes off only the office hop", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const own = await w.petrol(w.senior, '80');
      expect(own).toMatchObject({ status: 'PENDING', canDecide: false });
      expect(
        await tx.expense.findUniqueOrThrow({ where: { id: own.id } }),
      ).toMatchObject({ hop: 'SENIOR_TO_OFFICE' });

      await expect(
        w.field.decide(w.senior, own.id, { decision: 'APPROVED' }, evening),
      ).rejects.toMatchObject({ code: 'OWN_EXPENSE', status: 403 });
      // Another line's Senior cannot even see it.
      await expect(
        w.field.decide(
          w.otherSenior,
          own.id,
          { decision: 'APPROVED' },
          evening,
        ),
      ).rejects.toMatchObject({ status: 404 });

      // The Senior's petrol comes out of what they took from the Junior.
      const handover = await w.handovers.handOver(
        w.junior,
        {
          lineId: w.line.id,
          businessDate: MONDAY,
          counts: counts({ 500: 2 }),
        },
        evening,
      );
      await w.handovers.acknowledge(w.senior, handover.id, evening);
      await w.field.decide(w.admin, own.id, { decision: 'APPROVED' }, evening);
      expect((await w.cash(w.senior.userId)).own).toBe('920.00');
      // The line's day counts the Junior hop only.
      expect(
        await w.dayCloses.view(w.senior, w.line.id, MONDAY, evening),
      ).toMatchObject({ expenseTotal: '0.00' });

      const junior = await w.petrol(w.junior);
      await expect(
        w.field.decide(w.junior, junior.id, { decision: 'APPROVED' }, evening),
      ).rejects.toMatchObject({ code: 'OWN_EXPENSE', status: 403 });
    });
  });

  it('a Junior on two lines names the line, which must be one of theirs (decided 2026-10-03)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const onTwo: RequestContext = {
        ...w.junior,
        currentLineIds: [w.line.id, w.otherLine.id],
      };
      const ask = (who: RequestContext, lineId?: string) =>
        w.field.request(
          who,
          {
            categoryId: w.fuel.id,
            amount: '50',
            note: 'Petrol for the round',
            ...(lineId ? { lineId } : {}),
          },
          MONDAY,
        );

      await expect(ask(onTwo)).rejects.toMatchObject({
        code: 'LINE_REQUIRED',
        status: 422,
      });
      const spent = await ask(onTwo, w.otherLine.id);
      expect(
        await tx.expense.findUniqueOrThrow({ where: { id: spent.id } }),
      ).toMatchObject({ lineId: w.otherLine.id });
      // A line they are not on is missing, not forbidden (M02).
      await expect(ask(w.junior, w.otherLine.id)).rejects.toMatchObject({
        code: 'LINE_NOT_FOUND',
        status: 404,
      });
    });
  });

  it('refuses someone with no line today, and a retired category', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      await expect(
        w.petrol({ ...w.junior, currentLineIds: [] }),
      ).rejects.toMatchObject({ code: 'NOT_ON_A_LINE', status: 422 });
      await tx.expenseCategory.update({
        where: { id: w.fuel.id },
        data: { isActive: false },
      });
      await expect(w.petrol(w.junior)).rejects.toMatchObject({
        code: 'EXPENSE_CATEGORY_RETIRED',
      });
    });
  });
});
