import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { AccountService } from '../../src/accounts/account.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { HolidayService } from '../../src/calendar/holiday.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Declared holidays (M06, US-093, US-034) against real rows, rolled back.
 * Declaring writes the audit log, which rejects DELETE, and moves the slots of
 * disbursed accounts, which have ledger rows — so this tier is where it is
 * proven.
 *
 * The world's accounts are disbursed on Saturday 3 January 2026 with 20 slots
 * of D: Mon 5 … Sat 10, Mon 12 … Sat 17, Mon 19 … Sat 24, Mon 26 and Tue 27.
 */
const d = parseCalendarDate;
const TODAY = d('2026-01-06');
const HOLIDAY = '2026-01-15';

const ORIGINAL = [
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-01-09',
  '2026-01-10',
  '2026-01-12',
  '2026-01-13',
  '2026-01-14',
  '2026-01-15',
  '2026-01-16',
  '2026-01-17',
  '2026-01-19',
  '2026-01-20',
  '2026-01-21',
  '2026-01-22',
  '2026-01-23',
  '2026-01-24',
  '2026-01-26',
  '2026-01-27',
];
/** 15 January declared: slots 10 onwards each move one working day. */
const SHIFTED = [
  ...ORIGINAL.slice(0, 9),
  '2026-01-16',
  '2026-01-17',
  '2026-01-19',
  '2026-01-20',
  '2026-01-21',
  '2026-01-22',
  '2026-01-23',
  '2026-01-24',
  '2026-01-26',
  '2026-01-27',
  '2026-01-28',
];

async function holidayWorld(tx: PrismaClient) {
  const w = await cashWorld(tx);
  const database = new Database(tx);
  const holidays = new HolidayService(
    database,
    new AuditWriter(database),
    w.notices,
  );
  const schedule = async (accountLoanId: string) =>
    (
      await tx.accountSchedule.findMany({
        where: { accountLoanId },
        orderBy: { sequence: 'asc' },
      })
    ).map((slot) => ({
      sequence: slot.sequence,
      dueDate: slot.dueDate.toISOString().slice(0, 10),
      status: slot.status,
      expectedAmount: slot.expectedAmount.toFixed(2),
    }));
  const loan = (id: string) =>
    tx.accountLoan.findUniqueOrThrow({ where: { id } });
  const notices = (userId: string) =>
    tx.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  const sector = async (isActive = true) =>
    tx.sector.create({
      data: {
        organizationId: w.organizationId,
        code: `S-${randomUUID()}`,
        name: 'Hill sector',
        isActive,
      },
    });
  return { ...w, holidays, schedule, loan, notices, sector };
}

describe('HolidayService (US-093, US-034)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Scenario: holiday shifts the remaining schedule — the 15 January slot moves to the next working day, later slots follow, collected slots are untouched', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      const account = await w.account('100');
      await w.collect(account.id, '100', '2026-01-05');
      const before = await w.loan(account.id);

      const declared = await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );

      expect(declared).toMatchObject({
        date: HOLIDAY,
        name: 'Pongal',
        sector: null,
        addedBy: { userId: w.admin.userId },
        removable: true,
        accountsShifted: 1,
      });
      const slots = await w.schedule(account.id);
      expect(slots.map((slot) => slot.dueDate)).toEqual(SHIFTED);
      expect(slots[0]).toMatchObject({
        status: 'COLLECTED',
        dueDate: '2026-01-05',
      });
      expect(slots.slice(1).every((slot) => slot.status === 'PENDING')).toBe(
        true,
      );
      expect(slots.every((slot) => slot.expectedAmount === '100.00')).toBe(
        true,
      );
      expect(slots.map((slot) => slot.dueDate)).not.toContain(HOLIDAY);

      const after = await w.loan(account.id);
      expect(after.targetCompletionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-28',
      );
      expect(before.targetCompletionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-27',
      );
      // Only dates move: the balance and the first collection date stand.
      expect(after.outstandingAmount.toFixed(2)).toBe(
        before.outstandingAmount.toFixed(2),
      );
      expect(after.collectedAmount.toFixed(2)).toBe('100.00');
      expect(after.firstCollectionDate).toEqual(before.firstCollectionDate);

      const audit = await tx.auditLog.findMany({
        where: { entityTable: 'holiday', entityId: declared.id },
      });
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'CREATE',
          actorUserId: w.admin.userId,
          organizationId: w.organizationId,
          after: {
            date: HOLIDAY,
            name: 'Pongal',
            sectorId: null,
            accountsShifted: 1,
          },
        }),
      ]);
    });
  });

  it('removing the holiday moves the slots back and restores the target date', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      const account = await w.account('100');
      const declared = await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );

      const removed = await w.holidays.remove(w.admin, declared.id, TODAY);

      expect(removed).toMatchObject({ id: declared.id, accountsShifted: 1 });
      expect(
        (await w.schedule(account.id)).map((slot) => slot.dueDate),
      ).toEqual(ORIGINAL);
      const after = await w.loan(account.id);
      expect(after.targetCompletionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-27',
      );
      expect(await tx.holiday.count({ where: { id: declared.id } })).toBe(0);
      const audit = await tx.auditLog.findMany({
        where: { entityTable: 'holiday', entityId: declared.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((row) => row.action)).toEqual(['CREATE', 'DELETE']);
      expect(audit[1]!.before).toEqual({
        date: HOLIDAY,
        name: 'Pongal',
        sectorId: null,
      });
    });
  });

  it('Scenario: holiday raises no missed alerts — closing that day marks nothing MISSED', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      const account = await w.account('100');
      await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );

      const view = await w.dayCloses.view(
        w.senior,
        w.line.id,
        d(HOLIDAY),
        at(HOLIDAY, '20:00:00'),
      );
      expect(view.day).toEqual({ kind: 'HOLIDAY', name: 'Pongal' });
      expect(view.expectedTotal).toBe('0.00');

      await w.dayCloses.close(
        w.senior,
        w.line.id,
        d(HOLIDAY),
        true,
        at(HOLIDAY, '20:00:00'),
      );
      const slots = await w.schedule(account.id);
      expect(slots.some((slot) => slot.status === 'MISSED')).toBe(false);
      const alerts = await tx.notification.count({
        where: { userId: w.senior.userId, eventType: 'MISSED_COLLECTION' },
      });
      expect(alerts).toBe(0);
    });
  });

  it('tells the Seniors and Juniors of every line it covers, not the Admin who declared it', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );

      const [senior] = await w.notices(w.senior.userId);
      expect(senior).toMatchObject({
        category: 'WARNING',
        eventType: 'HOLIDAY_DECLARED',
        title: 'Holiday declared · 15 Jan 2026',
        payload: expect.objectContaining({ url: '/settings/holidays' }),
      });
      expect(senior!.body).toContain('Pongal: no collections on 15 Jan 2026.');
      const [junior] = await w.notices(w.junior.userId);
      expect(junior).toMatchObject({
        eventType: 'HOLIDAY_DECLARED',
        payload: expect.objectContaining({ url: '/route' }),
      });
      // The other line in the organization is covered by a business-wide holiday.
      expect(await w.notices(w.otherSenior.userId)).toHaveLength(1);
      expect(await w.notices(w.admin.userId)).toHaveLength(0);
    });
  });

  it('a sector holiday moves only that sector’s accounts and tells only its lines', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      const account = await w.account('100');
      const hills = await w.sector();

      const elsewhere = await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Hill festival', sectorId: hills.id },
        TODAY,
      );
      expect(elsewhere).toMatchObject({
        accountsShifted: 0,
        sector: { id: hills.id, name: 'Hill sector' },
      });
      expect(
        (await w.schedule(account.id)).map((slot) => slot.dueDate),
      ).toEqual(ORIGINAL);
      expect(await w.notices(w.senior.userId)).toHaveLength(0);

      const line = await tx.line.findUniqueOrThrow({
        where: { id: w.line.id },
      });
      const own = await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Local festival', sectorId: line.sectorId },
        TODAY,
      );
      expect(own.accountsShifted).toBe(1);
      expect(
        (await w.schedule(account.id)).map((slot) => slot.dueDate),
      ).toEqual(SHIFTED);

      // Business-wide on the same date: the account already skips it.
      const national = await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );
      expect(national.accountsShifted).toBe(0);
      // Removing the sector holiday leaves the business-wide one in force.
      const removed = await w.holidays.remove(w.admin, own.id, TODAY);
      expect(removed.accountsShifted).toBe(0);
      expect(
        (await w.schedule(account.id)).map((slot) => slot.dueDate),
      ).toEqual(SHIFTED);
    });
  });

  it('moves a pending account’s first collection date when the holiday falls on it', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await holidayWorld(tx);
      const customer = await tx.customer.create({
        data: {
          organizationId: w.organizationId,
          customerCode: `C-${randomUUID()}`,
          name: 'Later',
          mobile: '+919800000002',
          address: '1 Main Road',
          sectorId: (
            await tx.line.findUniqueOrThrow({ where: { id: w.line.id } })
          ).sectorId,
          lineId: w.line.id,
        },
      });
      const database = new Database(tx);
      const accounts = new AccountService(
        database,
        new AuditWriter(database),
        new LedgerService(database),
      );
      // Disbursed on Wed 14 January: first collection due Thu 15.
      const pending = await accounts.create(
        w.admin,
        {
          customerId: customer.id,
          accountAmount: '1000.00',
          investedAmount: '850.00',
          dailyAmount: '100',
          termDays: 10,
          disbursementDate: '2026-01-14',
          disburse: false,
        },
        TODAY,
      );

      await w.holidays.declare(
        w.admin,
        { date: HOLIDAY, name: 'Pongal' },
        TODAY,
      );

      const loan = await w.loan(pending.id);
      expect(loan.status).toBe('PENDING');
      expect(loan.firstCollectionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-16',
      );
      expect(loan.targetCompletionDate.toISOString().slice(0, 10)).toBe(
        '2026-01-27',
      );
      expect((await w.schedule(pending.id))[0]).toMatchObject({
        sequence: 1,
        dueDate: '2026-01-16',
      });
    });
  });

  describe('refusals', () => {
    it.each([
      ['today', '2026-01-06'],
      ['yesterday', '2026-01-05'],
    ])('refuses to declare %s — only future dates', async (_label, date) => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        await expect(
          w.holidays.declare(w.admin, { date, name: 'Late' }, TODAY),
        ).rejects.toMatchObject({
          status: 422,
          code: 'HOLIDAY_NOT_IN_FUTURE',
          details: [
            { field: 'date', issue: 'must be after today (2026-01-06)' },
          ],
        });
        expect(
          await tx.holiday.count({
            where: { organizationId: w.organizationId },
          }),
        ).toBe(0);
      });
    });

    it('refuses a Sunday', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        await expect(
          w.holidays.declare(
            w.admin,
            { date: '2026-01-18', name: 'Sunday' },
            TODAY,
          ),
        ).rejects.toMatchObject({
          status: 422,
          code: 'HOLIDAY_ON_SUNDAY',
          details: [{ field: 'date', issue: 'is a Sunday' }],
        });
      });
    });

    it('refuses the same date twice in the same scope, naming the holiday', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        await w.holidays.declare(
          w.admin,
          { date: HOLIDAY, name: 'Pongal' },
          TODAY,
        );
        await expect(
          w.holidays.declare(w.admin, { date: HOLIDAY, name: 'Again' }, TODAY),
        ).rejects.toMatchObject({
          status: 409,
          code: 'HOLIDAY_EXISTS',
          details: [{ field: 'date', issue: 'is already a holiday (Pongal)' }],
        });
      });
    });

    it('refuses an inactive sector (422) and another organization’s sector (404)', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        const closed = await w.sector(false);
        await expect(
          w.holidays.declare(
            w.admin,
            { date: HOLIDAY, name: 'X', sectorId: closed.id },
            TODAY,
          ),
        ).rejects.toMatchObject({ status: 422, code: 'SECTOR_INACTIVE' });

        const other = await holidayWorld(tx);
        const foreign = await other.sector();
        await expect(
          w.holidays.declare(
            w.admin,
            { date: HOLIDAY, name: 'X', sectorId: foreign.id },
            TODAY,
          ),
        ).rejects.toMatchObject({ status: 404, code: 'SECTOR_NOT_FOUND' });
      });
    });

    it('refuses to remove a holiday that is today or past, and changes nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        const past = await tx.holiday.create({
          data: {
            organizationId: w.organizationId,
            date: new Date('2026-01-06'),
            name: 'Already happened',
          },
        });
        await expect(
          w.holidays.remove(w.admin, past.id, TODAY),
        ).rejects.toMatchObject({
          status: 422,
          code: 'HOLIDAY_NOT_IN_FUTURE',
        });
        expect(await tx.holiday.count({ where: { id: past.id } })).toBe(1);
      });
    });

    it('answers 404 for another organization’s holiday, as for a missing one', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        const other = await holidayWorld(tx);
        const theirs = await other.holidays.declare(
          other.admin,
          { date: HOLIDAY, name: 'Theirs' },
          TODAY,
        );
        await expect(
          w.holidays.remove(w.admin, theirs.id, TODAY),
        ).rejects.toMatchObject({
          status: 404,
          code: 'HOLIDAY_NOT_FOUND',
        });
        await expect(
          w.holidays.remove(w.admin, 'missing', TODAY),
        ).rejects.toMatchObject({
          status: 404,
          code: 'HOLIDAY_NOT_FOUND',
        });
      });
    });
  });

  describe('list', () => {
    it('shows upcoming soonest first and past latest first, with who added each and whether it can be removed', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        for (const [date, name] of [
          ['2026-01-02', 'New Year break'],
          ['2026-01-05', 'Past Monday'],
        ] as const) {
          await tx.holiday.create({
            data: {
              organizationId: w.organizationId,
              date: new Date(date),
              name,
            },
          });
        }
        for (const [date, name] of [
          ['2026-03-04', 'Holi'],
          ['2026-01-26', 'Republic Day'],
          ['2026-01-15', 'Pongal'],
        ] as const) {
          await w.holidays.declare(w.admin, { date, name }, TODAY);
        }
        // Today's holiday is upcoming but no longer removable.
        await tx.holiday.create({
          data: {
            organizationId: w.organizationId,
            date: new Date('2026-01-06'),
            name: 'Today',
          },
        });

        const upcoming = await w.holidays.list(
          w.admin,
          { period: 'upcoming', limit: 50 },
          TODAY,
        );
        expect(upcoming.data.map((h) => [h.date, h.removable])).toEqual([
          ['2026-01-06', false],
          ['2026-01-15', true],
          ['2026-01-26', true],
          ['2026-03-04', true],
        ]);
        expect(upcoming.data[1]!.addedBy).toEqual({
          userId: w.admin.userId,
          name: 'Constraint Probe',
        });
        expect(upcoming.data[0]!.addedBy).toBeNull();

        const past = await w.holidays.list(
          w.admin,
          { period: 'past', limit: 50 },
          TODAY,
        );
        expect(past.data.map((h) => h.date)).toEqual([
          '2026-01-05',
          '2026-01-02',
        ]);
        expect(past.data.every((h) => !h.removable)).toBe(true);

        const in2026 = await w.holidays.list(
          w.admin,
          { period: 'upcoming', year: 2027, limit: 50 },
          TODAY,
        );
        expect(in2026.data).toEqual([]);
      });
    });

    it('pages without repeating or skipping a holiday', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        const dates = [
          '2026-02-02',
          '2026-02-03',
          '2026-02-04',
          '2026-02-05',
          '2026-02-06',
        ];
        for (const date of dates) {
          await tx.holiday.create({
            data: {
              organizationId: w.organizationId,
              date: new Date(date),
              name: date,
            },
          });
        }
        const seen: string[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await w.holidays.list(
            w.admin,
            { period: 'upcoming', limit: 2, cursor },
            TODAY,
          );
          seen.push(...page.data.map((h) => h.date));
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        expect(seen).toEqual(dates);
      });
    });

    it('shows a Senior the business-wide holidays and their own sector’s, not another sector’s', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await holidayWorld(tx);
        const hills = await w.sector();
        const line = await tx.line.findUniqueOrThrow({
          where: { id: w.line.id },
        });
        await w.holidays.declare(
          w.admin,
          { date: '2026-01-15', name: 'National' },
          TODAY,
        );
        await w.holidays.declare(
          w.admin,
          { date: '2026-01-16', name: 'Own sector', sectorId: line.sectorId },
          TODAY,
        );
        await w.holidays.declare(
          w.admin,
          { date: '2026-01-17', name: 'Hills', sectorId: hills.id },
          TODAY,
        );

        const names = async (context: RequestContext) =>
          (
            await w.holidays.list(
              context,
              { period: 'upcoming', limit: 50 },
              TODAY,
            )
          ).data.map((h) => h.name);
        expect(await names(w.senior)).toEqual(['National', 'Own sector']);
        expect(await names(w.junior)).toEqual(['National', 'Own sector']);
        expect(await names(w.admin)).toEqual([
          'National',
          'Own sector',
          'Hills',
        ]);
        expect(await names({ ...w.senior, currentLineId: null })).toEqual([]);

        const hillsHoliday = await tx.holiday.findFirstOrThrow({
          where: { sectorId: hills.id },
        });
        // Out of scope reads as missing.
        await expect(
          w.holidays.remove(w.senior, hillsHoliday.id, TODAY),
        ).rejects.toMatchObject({
          status: 404,
        });
      });
    });
  });
});
