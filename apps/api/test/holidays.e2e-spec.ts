import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  dayOfWeek,
  toBusinessDate,
} from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp, recordedAudit } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  type TestStaff,
} from './staff.js';

/**
 * M06 declared holidays over HTTP (US-093): roles, scope, validation and the
 * error shapes. The organization has no disbursed accounts, so nothing
 * append-only is written: audit entries go to `recordedAudit`, and the
 * schedule shift is proven in Tier 1. Holidays and notifications are removed
 * with the tagged organization and staff.
 */
describe('holidays (M06, US-093, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let sectorId: string;
  let otherSectorId: string;
  let foreignHolidayId: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  const today = toBusinessDate(new Date());

  /** The `n`-th weekday (not Sunday) after today. */
  const future = (n: number): CalendarDate => {
    let date = today;
    for (let found = 0; found < n;) {
      date = addCalendarDays(date, 1);
      if (dayOfWeek(date) !== 0) found += 1;
    }
    return date;
  };
  const nextSunday = (): CalendarDate => {
    let date = addCalendarDays(today, 1);
    while (dayOfWeek(date) !== 0) date = addCalendarDays(date, 1);
    return date;
  };

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookies[role]),
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A']);
    organizationId = org.organization.id;
    sectorId = org.sector.id;
    const lineId = org.lines[0]!.id;
    otherSectorId = (
      await prisma.sector.create({
        data: {
          organizationId,
          code: `${org.sector.code}-B`,
          name: 'Other sector',
        },
      })
    ).id;

    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, { organizationId, role });
      cookies[role] = await signIn(app, staff[role]);
    }
    await prisma.lineAssignment.createMany({
      data: (['SENIOR', 'JUNIOR'] as const).map((role) => ({
        staffProfileId: staff[role].staffProfileId,
        lineId,
        assignmentRole: role,
        effectiveFrom: new Date('2026-01-01'),
      })),
    });

    const foreign = await createTestOrganization(prisma);
    foreignHolidayId = (
      await prisma.holiday.create({
        data: {
          organizationId: foreign.organization.id,
          date: new Date(`${future(3)}T00:00:00Z`),
          name: 'Theirs',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    // Cleanup removes every holiday this run declared.
    expect(
      await prisma.holiday.count({
        where: { OR: [{ organizationId }, { id: foreignHolidayId }] },
      }),
    ).toBe(0);
    await prisma.$disconnect();
  });

  describe('declaring (Admin and Super Admin)', () => {
    it('an Admin declares a business-wide holiday: 201, contract fields, audited, line staff told', async () => {
      const date = future(1);
      const response = await as('ADMIN')
        .post('/api/holidays', { date, name: 'Festival', sectorId: '' })
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual([
        'accountsShifted',
        'addedBy',
        'createdAt',
        'date',
        'id',
        'name',
        'removable',
        'sector',
      ]);
      expect(response.body).toMatchObject({
        date,
        name: 'Festival',
        sector: null,
        addedBy: { userId: staff.ADMIN.userId, name: 'Test Staff' },
        removable: true,
        accountsShifted: 0,
      });
      expect(
        recordedAudit.find((row) => row.entityId === response.body.id),
      ).toMatchObject({
        entityTable: 'holiday',
        action: 'CREATE',
        actorUserId: staff.ADMIN.userId,
        organizationId,
      });
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        expect(
          await prisma.notification.count({
            where: {
              userId: staff[role].userId,
              eventType: 'HOLIDAY_DECLARED',
            },
          }),
        ).toBe(1);
      }
    });

    it('a Super Admin declares a sector holiday', async () => {
      const response = await as('SUPER_ADMIN')
        .post('/api/holidays', {
          date: future(2),
          name: 'Other sector festival',
          sectorId: otherSectorId,
        })
        .expect(201);
      expect(response.body.sector).toMatchObject({
        id: otherSectorId,
        name: 'Other sector',
      });
    });

    it('the same date again is 409 HOLIDAY_EXISTS at the date field', async () => {
      const date = future(4);
      await as('ADMIN')
        .post('/api/holidays', { date, name: 'First' })
        .expect(201);
      const response = await as('ADMIN')
        .post('/api/holidays', { date, name: 'Second' })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'HOLIDAY_EXISTS',
        details: [{ field: 'date', issue: 'is already a holiday (First)' }],
      });
    });

    it.each([
      ['today', () => today, 'HOLIDAY_NOT_IN_FUTURE'],
      ['yesterday', () => addCalendarDays(today, -1), 'HOLIDAY_NOT_IN_FUTURE'],
      ['a Sunday', nextSunday, 'HOLIDAY_ON_SUNDAY'],
    ])('%s is 422 at the date field', async (_label, date, code) => {
      const response = await as('ADMIN')
        .post('/api/holidays', { date: date(), name: 'Refused' })
        .expect(422);
      expect(response.body.code).toBe(code);
      expect(response.body.details[0].field).toBe('date');
    });

    it.each([
      [{ date: '2026-02-30', name: 'Bad date' }, 'date'],
      [{ date: '15-01-2027', name: 'Bad form' }, 'date'],
      [{ name: 'No date' }, 'date'],
      [{ date: '2099-01-15', name: '   ' }, 'name'],
    ])('invalid input %j is 400 at %s', async (body, field) => {
      const response = await as('ADMIN')
        .post('/api/holidays', body)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.details.map((detail: { field: string }) => detail.field),
      ).toContain(field);
    });

    it('a sector outside the organization is 404', async () => {
      const response = await as('ADMIN')
        .post('/api/holidays', {
          date: future(5),
          name: 'Nowhere',
          sectorId: 'no-such-sector',
        })
        .expect(404);
      expect(response.body.code).toBe('SECTOR_NOT_FOUND');
    });

    it.each(['SENIOR', 'JUNIOR'] as const)(
      'a %s may not declare (403) or remove (403)',
      async (role) => {
        const declare = await as(role)
          .post('/api/holidays', { date: future(6), name: 'Mine' })
          .expect(403);
        expect(declare.body.code).toBe('PERMISSION_DENIED');
        await as(role).delete(`/api/holidays/${foreignHolidayId}`).expect(403);
      },
    );
  });

  describe('listing (every role, own line for Seniors and Juniors)', () => {
    it('a Senior and a Junior see business-wide holidays but not another sector’s', async () => {
      await as('ADMIN')
        .post('/api/holidays', {
          date: future(7),
          name: 'Own sector day',
          sectorId,
        })
        .expect(201);
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const response = await as(role).get('/api/holidays').expect(200);
        const names = response.body.data.map((h: { name: string }) => h.name);
        expect(names).toContain('Festival');
        expect(names).toContain('Own sector day');
        expect(names).not.toContain('Other sector festival');
        expect(names).not.toContain('Theirs');
      }
      const admin = await as('ADMIN').get('/api/holidays').expect(200);
      const adminNames = admin.body.data.map((h: { name: string }) => h.name);
      expect(adminNames).toContain('Other sector festival');
      expect(adminNames).not.toContain('Theirs');
    });

    it('upcoming holidays come soonest first; past ones are listed separately', async () => {
      const upcoming = await as('ADMIN').get('/api/holidays').expect(200);
      const dates = upcoming.body.data.map((h: { date: string }) => h.date);
      expect(dates).toEqual([...dates].sort());
      expect(dates.every((date: string) => date >= today)).toBe(true);

      const past = await as('ADMIN')
        .get('/api/holidays?period=past')
        .expect(200);
      expect(past.body).toEqual({ data: [], nextCursor: null, hasMore: false });
    });

    it('pages with a cursor', async () => {
      const first = await as('ADMIN').get('/api/holidays?limit=1').expect(200);
      expect(first.body.hasMore).toBe(true);
      const second = await as('ADMIN')
        .get(`/api/holidays?limit=1&cursor=${first.body.nextCursor}`)
        .expect(200);
      expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    });

    it.each(['period=soon', 'year=abc', 'cursor=not-ours'])(
      '%s is 400',
      async (query) => {
        await as('ADMIN').get(`/api/holidays?${query}`).expect(400);
      },
    );
  });

  describe('removing (Admin and Super Admin, future only)', () => {
    it('an Admin removes a future holiday: 200, audited, gone from the list', async () => {
      const created = await as('ADMIN')
        .post('/api/holidays', { date: future(8), name: 'Removed later' })
        .expect(201);
      const removed = await as('ADMIN')
        .delete(`/api/holidays/${created.body.id}`)
        .expect(200);
      expect(removed.body).toMatchObject({
        id: created.body.id,
        removable: false,
        accountsShifted: 0,
      });
      expect(
        recordedAudit.find(
          (row) => row.entityId === created.body.id && row.action === 'DELETE',
        ),
      ).toMatchObject({ entityTable: 'holiday', organizationId });
      const list = await as('ADMIN').get('/api/holidays').expect(200);
      expect(list.body.data.map((h: { id: string }) => h.id)).not.toContain(
        created.body.id,
      );
      await as('ADMIN').delete(`/api/holidays/${created.body.id}`).expect(404);
    });

    it('a past holiday cannot be removed (422)', async () => {
      let pastDate = addCalendarDays(today, -2);
      if (dayOfWeek(pastDate) === 0) pastDate = addCalendarDays(pastDate, -1);
      const past = await prisma.holiday.create({
        data: {
          organizationId,
          date: new Date(`${pastDate}T00:00:00Z`),
          name: 'History',
        },
      });
      const response = await as('SUPER_ADMIN')
        .delete(`/api/holidays/${past.id}`)
        .expect(422);
      expect(response.body.code).toBe('HOLIDAY_NOT_IN_FUTURE');
      expect(await prisma.holiday.count({ where: { id: past.id } })).toBe(1);
    });

    it('another organization’s holiday is 404, like a missing one', async () => {
      const response = await as('ADMIN')
        .delete(`/api/holidays/${foreignHolidayId}`)
        .expect(404);
      expect(response.body.code).toBe('HOLIDAY_NOT_FOUND');
      expect(
        await prisma.holiday.count({ where: { id: foreignHolidayId } }),
      ).toBe(1);
    });
  });
});
