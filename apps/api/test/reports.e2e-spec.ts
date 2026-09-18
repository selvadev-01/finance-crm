import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import {
  addCalendarDays,
  parseCalendarDate,
  startOfMonth,
  toBusinessDate,
} from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testCode,
} from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * M12 reports over HTTP — the line-wise report (US-084), the investment
 * overview (US-085), the collection report (US-086) and the overdue report
 * (US-087). **Read-only**, on a tagged organization with no accounts: who may
 * call, which lines each role gets, validation, paging shape, and the shape of
 * an empty business. The figures are proven in Tier 1 (`test/reports/`), where
 * disbursements, collections and ledger rows roll back.
 */
describe('M12 reports (US-084, US-085, US-086, US-087, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let staffed: { id: string; code: string };
  let other: { id: string; code: string };
  let otherSector: { id: string };
  let foreignLine: { id: string };
  let foreignStaffUserId: string;
  const cookies = {} as Record<StaffRole, string>;
  const userIds = {} as Record<StaffRole, string>;
  const today = toBusinessDate(new Date());
  const path = '/api/reports/line-wise';

  const get = (role: StaffRole | null, url: string) => {
    const pending = request(app.getHttpServer()).get(url);
    return role ? pending.set('Cookie', cookies[role]) : pending;
  };

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Staffed', 'Other']);
    staffed = org.lines[0]!;
    other = org.lines[1]!;
    otherSector = await prisma.sector.create({
      data: {
        organizationId: org.organization.id,
        code: testCode('SEC'),
        name: 'Elsewhere',
      },
    });
    const foreign = await createTestOrganization(prisma, ['Foreign']);
    foreignLine = foreign.lines[0]!;
    foreignStaffUserId = (
      await createTestStaff(prisma, {
        organizationId: foreign.organization.id,
        role: 'JUNIOR',
        label: 'foreign-junior',
      })
    ).userId;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      const staff = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role,
      });
      if (role === 'SENIOR' || role === 'JUNIOR') {
        await prisma.lineAssignment.create({
          data: {
            staffProfileId: staff.staffProfileId,
            lineId: staffed.id,
            assignmentRole: role,
            effectiveFrom: new Date('2026-01-01'),
          },
        });
      }
      cookies[role] = await signIn(app, staff);
      userIds[role] = staff.userId;
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  const zeroTotals = (lines: number) => ({
    lines,
    book: {
      customers: 0,
      accounts: 0,
      activeAccounts: 0,
      completedAccounts: 0,
    },
    amounts: { accountAmount: '0.00', invested: '0.00', profit: '0.00' },
    collections: {
      expected: '0.00',
      collected: '0.00',
      pending: '0.00',
      extra: '0.00',
    },
  });

  it('Admins see every line, the month so far by default; a Junior is 403; no session is 401', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const response = await get(role, path).expect(200);
      expect(response.body).toMatchObject({
        from: startOfMonth(today),
        to: today,
        // No accounts: real zeros, as strings.
        totals: zeroTotals(2),
      });
      expect(
        response.body.lines
          .map((line: { lineId: string }) => line.lineId)
          .sort(),
      ).toEqual([staffed.id, other.id].sort());
      expect(
        response.body.lines.find(
          (line: { lineId: string }) => line.lineId === staffed.id,
        ),
      ).toMatchObject({
        code: staffed.code,
        name: 'Staffed',
        staff: {
          seniorName: expect.any(String),
          juniorNames: [expect.any(String)],
        },
      });
    }

    const junior = await get('JUNIOR', path).expect(403);
    expect(junior.body.code).toBe('PERMISSION_DENIED');
    const anonymous = await get(null, path).expect(401);
    expect(anonymous.body.code).toBe('UNAUTHENTICATED');
  });

  it('a Senior gets their own line only, and another line or sector is 404 (M02)', async () => {
    const own = await get('SENIOR', path).expect(200);
    expect(
      own.body.lines.map((line: { lineId: string }) => line.lineId),
    ).toEqual([staffed.id]);
    // Invested and profit are own-line cells for a Senior.
    expect(own.body.lines[0].amounts).toEqual({
      accountAmount: '0.00',
      invested: '0.00',
      profit: '0.00',
    });
    expect(own.body.totals).toEqual(zeroTotals(1));

    const otherLine = await get('SENIOR', `${path}?lineId=${other.id}`).expect(
      404,
    );
    expect(otherLine.body.code).toBe('LINE_NOT_FOUND');
    const elsewhere = await get(
      'SENIOR',
      `${path}?sectorId=${otherSector.id}`,
    ).expect(404);
    expect(elsewhere.body.code).toBe('SECTOR_NOT_FOUND');
  });

  it('filters by sector and line, and another organization’s line is 404', async () => {
    const one = await get('ADMIN', `${path}?lineId=${other.id}`).expect(200);
    expect(
      one.body.lines.map((line: { lineId: string }) => line.lineId),
    ).toEqual([other.id]);
    const empty = await get(
      'ADMIN',
      `${path}?sectorId=${otherSector.id}`,
    ).expect(200);
    expect(empty.body).toMatchObject({ lines: [], totals: zeroTotals(0) });

    const foreign = await get(
      'ADMIN',
      `${path}?lineId=${foreignLine.id}`,
    ).expect(404);
    expect(foreign.body.code).toBe('LINE_NOT_FOUND');
  });

  it('takes a range up to 93 days, refuses a malformed, reversed or longer one (400) and a future end (422)', async () => {
    const to = parseCalendarDate(today);
    const from = addCalendarDays(to, -92);
    const quarter = await get('ADMIN', `${path}?from=${from}&to=${to}`).expect(
      200,
    );
    expect(quarter.body).toMatchObject({ from, to });

    const tooLong = await get(
      'ADMIN',
      `${path}?from=${addCalendarDays(to, -93)}&to=${to}`,
    ).expect(400);
    expect(tooLong.body.code).toBe('INVALID_DATE_RANGE');
    const reversed = await get(
      'ADMIN',
      `${path}?from=${to}&to=${addCalendarDays(to, -1)}`,
    ).expect(400);
    expect(reversed.body.code).toBe('INVALID_DATE_RANGE');
    await get('ADMIN', `${path}?from=2026-02-30`).expect(400);

    const future = await get(
      'ADMIN',
      `${path}?to=${addCalendarDays(to, 1)}`,
    ).expect(422);
    expect(future.body.code).toBe('DATE_IN_FUTURE');
  });

  describe('investment overview (US-085, §22)', () => {
    const investment = '/api/reports/investment';
    const zeroPosition = {
      accounts: 0,
      accountAmount: '0.00',
      invested: '0.00',
      profit: '0.00',
      outstanding: '0.00',
      returned: '0.00',
      profitEarned: '0.00',
      profitToEarn: '0.00',
    };
    const zeroRange = {
      disbursements: 0,
      accountAmount: '0.00',
      invested: '0.00',
      profit: '0.00',
      returned: '0.00',
      profitEarned: '0.00',
    };

    it('Admins see every line, the month so far by default; a Junior is 403; no session is 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const response = await get(role, investment).expect(200);
        expect(response.body).toMatchObject({
          from: startOfMonth(today),
          to: today,
          // Nothing disbursed: real zeros, as strings.
          totals: { lines: 2, position: zeroPosition, range: zeroRange },
        });
        expect(
          response.body.lines
            .map((line: { lineId: string }) => line.lineId)
            .sort(),
        ).toEqual([staffed.id, other.id].sort());
      }

      const junior = await get('JUNIOR', investment).expect(403);
      expect(junior.body.code).toBe('PERMISSION_DENIED');
      const anonymous = await get(null, investment).expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('a Senior gets their own line’s invested and profit, and another line or sector is 404 (M02)', async () => {
      const own = await get('SENIOR', investment).expect(200);
      expect(
        own.body.lines.map((line: { lineId: string }) => line.lineId),
      ).toEqual([staffed.id]);
      expect(own.body.lines[0].position).toEqual(zeroPosition);
      expect(own.body.totals).toEqual({
        lines: 1,
        position: zeroPosition,
        range: zeroRange,
      });

      const otherLine = await get(
        'SENIOR',
        `${investment}?lineId=${other.id}`,
      ).expect(404);
      expect(otherLine.body.code).toBe('LINE_NOT_FOUND');
      const elsewhere = await get(
        'SENIOR',
        `${investment}?sectorId=${otherSector.id}`,
      ).expect(404);
      expect(elsewhere.body.code).toBe('SECTOR_NOT_FOUND');
    });

    it('filters by sector and line; another organization’s line is 404, and a bad range is refused', async () => {
      const one = await get('ADMIN', `${investment}?lineId=${other.id}`).expect(
        200,
      );
      expect(
        one.body.lines.map((line: { lineId: string }) => line.lineId),
      ).toEqual([other.id]);
      const empty = await get(
        'ADMIN',
        `${investment}?sectorId=${otherSector.id}`,
      ).expect(200);
      expect(empty.body).toMatchObject({
        lines: [],
        totals: { lines: 0, position: zeroPosition, range: zeroRange },
      });
      const foreign = await get(
        'ADMIN',
        `${investment}?lineId=${foreignLine.id}`,
      ).expect(404);
      expect(foreign.body.code).toBe('LINE_NOT_FOUND');

      const to = parseCalendarDate(today);
      const quarter = await get(
        'ADMIN',
        `${investment}?from=${addCalendarDays(to, -92)}&to=${to}`,
      ).expect(200);
      expect(quarter.body.to).toBe(to);
      const tooLong = await get(
        'ADMIN',
        `${investment}?from=${addCalendarDays(to, -93)}&to=${to}`,
      ).expect(400);
      expect(tooLong.body.code).toBe('INVALID_DATE_RANGE');
      await get('ADMIN', `${investment}?from=2026-02-30`).expect(400);
      const future = await get(
        'ADMIN',
        `${investment}?to=${addCalendarDays(to, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
    });
  });

  describe('collection report (US-086, BR-08)', () => {
    const collection = '/api/reports/collection';
    const zeroCollections = {
      expected: '0.00',
      collected: '0.00',
      variance: '0.00',
      pending: '0.00',
      extra: '0.00',
      missed: 0,
    };
    const noTally = { count: 0, amount: '0.00' };
    const zeroClassification = {
      recorded: 0,
      amount: '0.00',
      correct: noTally,
      low: noTally,
      extra: noTally,
      noPayment: noTally,
      adjusted: noTally,
    };
    const zeroTotals = (lines: number) => ({
      lines,
      collections: zeroCollections,
      classification: zeroClassification,
    });

    it('Admins see every line, the month so far by default; a Junior is 403; no session is 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const response = await get(role, collection).expect(200);
        expect(response.body).toMatchObject({
          from: startOfMonth(today),
          to: today,
          // Nothing collected: real zeros, as strings.
          totals: zeroTotals(2),
        });
        expect(
          response.body.lines
            .map((line: { lineId: string }) => line.lineId)
            .sort(),
        ).toEqual([staffed.id, other.id].sort());
      }

      const junior = await get('JUNIOR', collection).expect(403);
      expect(junior.body.code).toBe('PERMISSION_DENIED');
      const anonymous = await get(null, collection).expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('a Senior gets their own line only; another line, sector or collector is 404 (M02)', async () => {
      const own = await get('SENIOR', collection).expect(200);
      expect(
        own.body.lines.map((line: { lineId: string }) => line.lineId),
      ).toEqual([staffed.id]);
      expect(own.body.totals).toEqual(zeroTotals(1));

      // Their own line's Junior is theirs to ask about.
      const theirs = await get(
        'SENIOR',
        `${collection}?collectedByUserId=${userIds.JUNIOR}`,
      ).expect(200);
      expect(theirs.body.totals).toEqual(zeroTotals(1));

      const otherLine = await get(
        'SENIOR',
        `${collection}?lineId=${other.id}`,
      ).expect(404);
      expect(otherLine.body.code).toBe('LINE_NOT_FOUND');
      const elsewhere = await get(
        'SENIOR',
        `${collection}?sectorId=${otherSector.id}`,
      ).expect(404);
      expect(elsewhere.body.code).toBe('SECTOR_NOT_FOUND');
      // An Admin works no line, so a Senior cannot ask after them.
      const stranger = await get(
        'SENIOR',
        `${collection}?collectedByUserId=${userIds.ADMIN}`,
      ).expect(404);
      expect(stranger.body.code).toBe('STAFF_NOT_FOUND');
    });

    it('filters by sector, line, collector and class; another organization’s row is 404', async () => {
      const one = await get('ADMIN', `${collection}?lineId=${other.id}`).expect(
        200,
      );
      expect(
        one.body.lines.map((line: { lineId: string }) => line.lineId),
      ).toEqual([other.id]);
      const empty = await get(
        'ADMIN',
        `${collection}?sectorId=${otherSector.id}`,
      ).expect(200);
      expect(empty.body).toMatchObject({ lines: [], totals: zeroTotals(0) });

      const narrowed = await get(
        'ADMIN',
        `${collection}?collectedByUserId=${userIds.JUNIOR}&classification=LOW`,
      ).expect(200);
      expect(narrowed.body.totals).toEqual(zeroTotals(2));
      await get('ADMIN', `${collection}?classification=MISSED`).expect(400);

      const foreign = await get(
        'ADMIN',
        `${collection}?lineId=${foreignLine.id}`,
      ).expect(404);
      expect(foreign.body.code).toBe('LINE_NOT_FOUND');
      const foreignStaff = await get(
        'ADMIN',
        `${collection}?collectedByUserId=${foreignStaffUserId}`,
      ).expect(404);
      expect(foreignStaff.body.code).toBe('STAFF_NOT_FOUND');
    });

    it('takes the same range rule as every report: 93 days, nothing reversed, nothing future', async () => {
      const to = parseCalendarDate(today);
      const quarter = await get(
        'ADMIN',
        `${collection}?from=${addCalendarDays(to, -92)}&to=${to}`,
      ).expect(200);
      expect(quarter.body.to).toBe(to);
      const tooLong = await get(
        'ADMIN',
        `${collection}?from=${addCalendarDays(to, -93)}&to=${to}`,
      ).expect(400);
      expect(tooLong.body.code).toBe('INVALID_DATE_RANGE');
      const reversed = await get(
        'ADMIN',
        `${collection}?from=${to}&to=${addCalendarDays(to, -1)}`,
      ).expect(400);
      expect(reversed.body.code).toBe('INVALID_DATE_RANGE');
      await get('ADMIN', `${collection}?from=2026-02-30`).expect(400);
      const future = await get(
        'ADMIN',
        `${collection}?to=${addCalendarDays(to, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
    });
  });

  describe('overdue report (US-087, BR-05)', () => {
    const overdue = '/api/reports/overdue';
    /** No account exists on this organization, so nobody is behind. */
    const emptySummary = {
      accounts: 0,
      lines: 0,
      outstanding: '0.00',
      arrears: '0.00',
      longestOverdue: null,
    };

    it('answers with a cursor page as of today; a Junior is 403 and no session 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
        const response = await get(role, overdue).expect(200);
        expect(response.body).toMatchObject({
          asOf: today,
          data: [],
          nextCursor: null,
          hasMore: false,
          summary: emptySummary,
        });
        expect(typeof response.body.generatedAt).toBe('string');
        // A period report's dates have no meaning here: the position is now.
        expect(response.body.from).toBeUndefined();
      }

      const junior = await get('JUNIOR', overdue).expect(403);
      expect(junior.body.code).toBe('PERMISSION_DENIED');
      const anonymous = await get(null, overdue).expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('takes both orders, a page size and the days filter; anything else is 400', async () => {
      for (const sort of ['daysOverdue', 'outstanding'] as const) {
        await get('ADMIN', `${overdue}?sort=${sort}&limit=1`).expect(200);
      }
      await get('ADMIN', `${overdue}?minDaysOverdue=30`).expect(200);
      await get('ADMIN', `${overdue}?sort=arrears`).expect(400);
      await get('ADMIN', `${overdue}?minDaysOverdue=0`).expect(400);
      await get('ADMIN', `${overdue}?limit=500`).expect(400);
      const cursor = await get('ADMIN', `${overdue}?cursor=nonsense`).expect(
        400,
      );
      expect(cursor.body.code).toBe('INVALID_CURSOR');
    });

    it('a Senior gets their own line; another line or sector is 404 (M02)', async () => {
      const own = await get('SENIOR', `${overdue}?lineId=${staffed.id}`).expect(
        200,
      );
      expect(own.body.summary).toEqual(emptySummary);

      const otherLine = await get(
        'SENIOR',
        `${overdue}?lineId=${other.id}`,
      ).expect(404);
      expect(otherLine.body.code).toBe('LINE_NOT_FOUND');
      const elsewhere = await get(
        'SENIOR',
        `${overdue}?sectorId=${otherSector.id}`,
      ).expect(404);
      expect(elsewhere.body.code).toBe('SECTOR_NOT_FOUND');

      const foreign = await get(
        'ADMIN',
        `${overdue}?lineId=${foreignLine.id}`,
      ).expect(404);
      expect(foreign.body.code).toBe('LINE_NOT_FOUND');
    });
  });
});
