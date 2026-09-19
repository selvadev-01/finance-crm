import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { addCalendarDays, toBusinessDate } from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * M11 dashboards over HTTP — the business overview (US-080, S-07), the sector
 * comparison (US-081), the Admin operational dashboard (US-082, S-20) and the
 * line dashboard (US-083, S-19). **Read-only**, on
 * a tagged organization with no accounts: who may call, validation, and the
 * shape of an empty business. The figures themselves are proven in Tier 1
 * (`test/dashboards/`), where collections and ledger rows roll back.
 */
describe('operations dashboard (M11, US-082, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let staffed: { id: string; code: string };
  let unstaffed: { id: string; code: string };
  const cookies = {} as Record<StaffRole, string>;
  const today = toBusinessDate(new Date());

  const get = (role: StaffRole | null, path: string) => {
    const pending = request(app.getHttpServer()).get(path);
    return role ? pending.set('Cookie', cookies[role]) : pending;
  };

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Staffed', 'Unstaffed']);
    staffed = org.lines[0]!;
    unstaffed = org.lines[1]!;
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
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('Admins and Super Admins see today; a Senior and a Junior are 403; no session is 401', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const response = await get(role, '/api/dashboards/operations').expect(
        200,
      );
      expect(response.body).toMatchObject({
        businessDate: today,
        customers: { new: 0, active: 0 },
        accounts: { total: 0, active: 0, completed: 0 },
        // No disbursements: a real zero, as a string.
        investment: { invested: '0.00', profit: '0.00' },
        pendingApprovals: { total: 0, awaitingYou: 0 },
        today: {
          expected: '0.00',
          collected: '0.00',
          pending: '0.00',
          extra: '0.00',
          lowCount: 0,
          extraCount: 0,
        },
      });
      expect(
        response.body.lines
          .map((line: { lineId: string }) => line.lineId)
          .sort(),
      ).toEqual([staffed.id, unstaffed.id].sort());
      expect(response.body.attention).toContainEqual(
        expect.objectContaining({ kind: 'NO_SENIOR', lineId: unstaffed.id }),
      );
      expect(response.body.attention).not.toContainEqual(
        expect.objectContaining({ kind: 'NO_SENIOR', lineId: staffed.id }),
      );
    }
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const denied = await get(role, '/api/dashboards/operations').expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
    }
    const anonymous = await get(null, '/api/dashboards/operations').expect(401);
    expect(anonymous.body.code).toBe('UNAUTHENTICATED');
  });

  it('takes an earlier date, refuses a malformed one (400) and a future one (422)', async () => {
    const yesterday = addCalendarDays(today, -1);
    const past = await get(
      'ADMIN',
      `/api/dashboards/operations?date=${yesterday}`,
    ).expect(200);
    expect(past.body.businessDate).toBe(yesterday);

    const malformed = await get(
      'ADMIN',
      '/api/dashboards/operations?date=2026-02-30',
    ).expect(400);
    expect(malformed.body.details[0].field).toBe('date');

    const future = await get(
      'SUPER_ADMIN',
      `/api/dashboards/operations?date=${addCalendarDays(today, 1)}`,
    ).expect(422);
    expect(future.body.code).toBe('DATE_IN_FUTURE');

    // Reading writes nothing: no day is opened by looking at it.
    expect(
      await prisma.dayClose.count({
        where: { lineId: { in: [staffed.id, unstaffed.id] } },
      }),
    ).toBe(0);
  });

  describe('business overview (US-080, S-07)', () => {
    it('Super Admins and Admins see the empty business today; a Senior and a Junior are 403; no session is 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const response = await get(role, '/api/dashboards/overview').expect(
          200,
        );
        expect(response.body).toEqual({
          businessDate: today,
          day: expect.objectContaining({ kind: expect.any(String) }),
          generatedAt: expect.any(String),
          // Two lines in one sector: set up, and every figure a real zero.
          setupNeeded: false,
          today: {
            expected: '0.00',
            collected: '0.00',
            pending: '0.00',
            extra: '0.00',
            lowCount: 0,
            extraCount: 0,
          },
          structure: { sectors: 1, lines: 2, customers: 0 },
          accounts: { active: 0, completed: 0 },
          totals: { accountAmount: '0.00', invested: '0.00', profit: '0.00' },
          sectors: [
            expect.objectContaining({
              lineCount: 2,
              expected: '0.00',
              collected: '0.00',
              shortfall: '0.00',
              surplus: '0.00',
            }),
          ],
          tally: expect.objectContaining({
            tallied: 0,
            withExtra: 0,
            withLow: 0,
          }),
        });
      }
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const denied = await get(role, '/api/dashboards/overview').expect(403);
        expect(denied.body.code).toBe('PERMISSION_DENIED');
      }
      const anonymous = await get(null, '/api/dashboards/overview').expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('takes an earlier date, refuses a malformed one (400) and a future one (422), and opens no day', async () => {
      const yesterday = addCalendarDays(today, -1);
      const past = await get(
        'SUPER_ADMIN',
        `/api/dashboards/overview?date=${yesterday}`,
      ).expect(200);
      expect(past.body.businessDate).toBe(yesterday);

      const malformed = await get(
        'SUPER_ADMIN',
        '/api/dashboards/overview?date=2026-02-30',
      ).expect(400);
      expect(malformed.body.details[0].field).toBe('date');

      const future = await get(
        'ADMIN',
        `/api/dashboards/overview?date=${addCalendarDays(today, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');

      expect(
        await prisma.dayClose.count({
          where: { lineId: { in: [staffed.id, unstaffed.id] } },
        }),
      ).toBe(0);
    });

    it('a Super Admin of an organization with a sector but no line yet gets the setup state', async () => {
      const empty = await createTestOrganization(prisma, []);
      const staff = await createTestStaff(prisma, {
        organizationId: empty.organization.id,
        role: 'SUPER_ADMIN',
      });
      const cookie = await signIn(app, staff);
      const response = await request(app.getHttpServer())
        .get('/api/dashboards/overview')
        .set('Cookie', cookie)
        .expect(200);
      expect(response.body).toMatchObject({
        setupNeeded: true,
        structure: { sectors: 1, lines: 0, customers: 0 },
        sectors: [],
        tally: { collecting: 0, tallied: 0, withExtra: 0, withLow: 0 },
      });
    });
  });

  describe('sector comparison (US-081)', () => {
    it('Super Admins and Admins see each sector’s empty day; a Senior and a Junior are 403; no session is 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const response = await get(role, '/api/dashboards/sectors').expect(200);
        const zeroDay = {
          expected: '0.00',
          collected: '0.00',
          shortfall: '0.00',
          surplus: '0.00',
          lowCount: 0,
          extraCount: 0,
          linesClosed: 0,
          linesTallied: 0,
        };
        expect(response.body).toEqual({
          businessDate: today,
          day: expect.objectContaining({ kind: expect.any(String) }),
          generatedAt: expect.any(String),
          setupNeeded: false,
          // One sector with two lines, no customers: every figure a real zero.
          sectors: [
            {
              sectorId: expect.any(String),
              code: expect.any(String),
              name: expect.any(String),
              isActive: true,
              structure: { lines: 2, customers: 0 },
              totals: {
                accountAmount: '0.00',
                invested: '0.00',
                profit: '0.00',
              },
              today: expect.objectContaining(zeroDay),
            },
          ],
          business: {
            structure: { sectors: 1, lines: 2, customers: 0 },
            totals: { accountAmount: '0.00', invested: '0.00', profit: '0.00' },
            today: expect.objectContaining(zeroDay),
          },
          tally: expect.objectContaining({
            tallied: 0,
            withExtra: 0,
            withLow: 0,
          }),
        });
      }
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const denied = await get(role, '/api/dashboards/sectors').expect(403);
        expect(denied.body.code).toBe('PERMISSION_DENIED');
      }
      const anonymous = await get(null, '/api/dashboards/sectors').expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('takes an earlier date, refuses a malformed one (400) and a future one (422), and opens no day', async () => {
      const yesterday = addCalendarDays(today, -1);
      const past = await get(
        'ADMIN',
        `/api/dashboards/sectors?date=${yesterday}`,
      ).expect(200);
      expect(past.body.businessDate).toBe(yesterday);

      const malformed = await get(
        'SUPER_ADMIN',
        '/api/dashboards/sectors?date=2026-02-30',
      ).expect(400);
      expect(malformed.body.details[0].field).toBe('date');

      const future = await get(
        'ADMIN',
        `/api/dashboards/sectors?date=${addCalendarDays(today, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');

      expect(
        await prisma.dayClose.count({
          where: { lineId: { in: [staffed.id, unstaffed.id] } },
        }),
      ).toBe(0);
    });

    it('a Super Admin of an organization with a sector but no line yet gets the setup state and the empty sector', async () => {
      const empty = await createTestOrganization(prisma, []);
      const staff = await createTestStaff(prisma, {
        organizationId: empty.organization.id,
        role: 'SUPER_ADMIN',
      });
      const cookie = await signIn(app, staff);
      const response = await request(app.getHttpServer())
        .get('/api/dashboards/sectors')
        .set('Cookie', cookie)
        .expect(200);
      expect(response.body).toMatchObject({
        setupNeeded: true,
        sectors: [
          {
            structure: { lines: 0, customers: 0 },
            today: { tally: 'NO_COLLECTIONS', linesToClose: 0 },
          },
        ],
        business: { structure: { sectors: 1, lines: 0, customers: 0 } },
        tally: { collecting: 0, tallied: 0, withExtra: 0, withLow: 0 },
      });
      // Another organization's sectors never appear.
      expect(response.body.sectors).toHaveLength(1);
    });
  });

  describe('line dashboard (US-083, S-19)', () => {
    it("a Senior sees their current line's empty day; a Junior is 403; no session is 401", async () => {
      const response = await get('SENIOR', '/api/dashboards/line').expect(200);
      expect(response.body).toMatchObject({
        state: 'LINE',
        businessDate: today,
        line: { lineId: staffed.id, name: 'Staffed' },
        day: {
          status: 'OPEN',
          expected: '0.00',
          collected: '0.00',
          shortfall: '0.00',
          surplus: '0.00',
          cashReceived: '0.00',
          discrepancy: '0.00',
          exceptions: [],
        },
        pendingApprovals: { total: 0, awaitingYou: 0 },
        nearingCompletion: { total: 0, items: [] },
        overdue: { total: 0, items: [] },
      });
      expect(response.body.day.juniors).toHaveLength(1);
      // No invested or profit figures reach a Senior here.
      expect(JSON.stringify(response.body)).not.toMatch(/invested|profit/i);

      const junior = await get('JUNIOR', '/api/dashboards/line').expect(403);
      expect(junior.body.code).toBe('PERMISSION_DENIED');
      const anonymous = await get(null, '/api/dashboards/line').expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('another line is 404 for a Senior, as a missing one is; Admins name any line and get the empty state without one', async () => {
      const other = await get(
        'SENIOR',
        `/api/dashboards/line?lineId=${unstaffed.id}`,
      ).expect(404);
      const missing = await get(
        'SENIOR',
        '/api/dashboards/line?lineId=no-such-line',
      ).expect(404);
      expect(other.body.code).toBe('LINE_NOT_FOUND');
      expect(missing.body.code).toBe(other.body.code);
      expect(missing.body.message).toBe(other.body.message);

      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const named = await get(
          role,
          `/api/dashboards/line?lineId=${unstaffed.id}`,
        ).expect(200);
        expect(named.body).toMatchObject({
          state: 'LINE',
          line: { lineId: unstaffed.id },
        });
        const unnamed = await get(role, '/api/dashboards/line').expect(200);
        expect(unnamed.body).toEqual({
          state: 'NO_LINE',
          businessDate: today,
          generatedAt: expect.any(String),
        });
      }
    });

    it('a Senior with no line today gets the empty state; a future date is 422', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId: (
          await prisma.line.findUniqueOrThrow({
            where: { id: staffed.id },
            select: { organizationId: true },
          })
        ).organizationId,
        role: 'SENIOR',
      });
      const cookie = await signIn(app, staff);
      const response = await request(app.getHttpServer())
        .get('/api/dashboards/line')
        .set('Cookie', cookie)
        .expect(200);
      expect(response.body).toMatchObject({
        state: 'NO_LINE',
        businessDate: today,
      });

      const future = await get(
        'SENIOR',
        `/api/dashboards/line?date=${addCalendarDays(today, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
      expect(
        await prisma.dayClose.count({
          where: { lineId: { in: [staffed.id, unstaffed.id] } },
        }),
      ).toBe(0);
    });
  });

  describe('dashboard trend (S-07, S-19, S-20)', () => {
    it('Admins get every line and a Senior their own, thirty working days of zeros ending today; a Junior is 403; no session is 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const response = await get(role, '/api/dashboards/trend').expect(200);
        expect(response.body).toMatchObject({
          businessDate: today,
          days: 30,
          lineCount: 2,
        });
        expect(response.body.points).toHaveLength(30);
        expect(response.body.points[0]).toEqual({
          businessDate: expect.any(String),
          expected: '0.00',
          collected: '0.00',
        });
      }
      const senior = await get('SENIOR', '/api/dashboards/trend?days=5').expect(
        200,
      );
      expect(senior.body).toMatchObject({ days: 5, lineCount: 1 });
      expect(senior.body.points).toHaveLength(5);

      const junior = await get('JUNIOR', '/api/dashboards/trend').expect(403);
      expect(junior.body.code).toBe('PERMISSION_DENIED');
      const anonymous = await get(null, '/api/dashboards/trend').expect(401);
      expect(anonymous.body.code).toBe('UNAUTHENTICATED');
    });

    it('another line is 404 for a Senior; more than sixty days is 400; a future date is 422', async () => {
      const other = await get(
        'SENIOR',
        `/api/dashboards/trend?lineId=${unstaffed.id}`,
      ).expect(404);
      expect(other.body.code).toBe('LINE_NOT_FOUND');
      await get('ADMIN', `/api/dashboards/trend?lineId=${unstaffed.id}`).expect(
        200,
      );
      await get('ADMIN', '/api/dashboards/trend?days=61').expect(400);
      const future = await get(
        'ADMIN',
        `/api/dashboards/trend?date=${addCalendarDays(today, 1)}`,
      ).expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
    });
  });
});
