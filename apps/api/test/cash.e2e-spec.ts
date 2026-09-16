import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { toBusinessDate } from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  type TestStaff,
} from './staff.js';

/**
 * M08 over HTTP (US-060…US-064). **Never closes a day or hands over cash**:
 * those write `day_close`, handovers, ledger rows and the audit log, which the
 * run-tagged cleanup cannot remove, so every successful write is proven in
 * Tier 1 (`test/cash/*.spec.ts`). Here: who may call, validation, refusals
 * that write nothing, and the phone's sync report, which cascades away with
 * its staff member.
 */
describe('day close and cash (M08, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let lineA: string;
  let lineB: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  const today = toBusinessDate(new Date());

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A', 'Line B']);
    lineA = org.lines[0]!.id;
    lineB = org.lines[1]!.id;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role,
      });
      cookies[role] = await signIn(app, staff[role]);
    }
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      await prisma.lineAssignment.create({
        data: {
          staffProfileId: staff[role].staffProfileId,
          lineId: lineA,
          assignmentRole: role,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it("a Junior's phone reports its queue; the report is validated and only a Junior sends one", async () => {
    const reported = await as('JUNIOR')
      .post('/api/devices/sync-report', {
        unsentCount: 3,
        oldestUnsentAt: new Date().toISOString(),
      })
      .expect(200);
    expect(reported.body.reportedAt).toEqual(expect.any(String));
    const row = await prisma.deviceSyncReport.findUniqueOrThrow({
      where: { staffProfileId: staff.JUNIOR.staffProfileId },
    });
    expect(row.unsentCount).toBe(3);

    const invalid = await as('JUNIOR')
      .post('/api/devices/sync-report', { unsentCount: -1 })
      .expect(400);
    expect(invalid.body.details[0].field).toBe('unsentCount');
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
      await as(role)
        .post('/api/devices/sync-report', { unsentCount: 0 })
        .expect(403);
    }
  });

  it("day close: Admins and the line's Senior see it; a Junior is 403; another line is 404 to a Senior", async () => {
    const path = `/api/lines/${lineA}/day-closes/${today}`;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
      const view = await as(role).get(path).expect(200);
      expect(view.body).toMatchObject({
        lineId: lineA,
        businessDate: today,
        status: 'OPEN',
        expectedTotal: '0.00',
      });
    }
    await as('JUNIOR').get(path).expect(403);
    const other = await as('SENIOR')
      .get(`/api/lines/${lineB}/day-closes/${today}`)
      .expect(404);
    expect(other.body.code).toBe('LINE_NOT_FOUND');
    await as('ADMIN')
      .get(`/api/lines/${lineA}/day-closes/not-a-date`)
      .expect(400);
    // Viewing never creates the day's row.
    expect(
      await prisma.dayClose.count({
        where: { lineId: { in: [lineA, lineB] } },
      }),
    ).toBe(0);
  });

  it('closing is for Seniors and Admins, reopening for Admins; refusals write nothing', async () => {
    const base = `/api/lines/${lineA}/day-closes`;
    await as('JUNIOR').post(`${base}/${today}/close`).expect(403);
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      await as(role)
        .post(`${base}/${today}/reopen`, { reason: 'x' })
        .expect(403);
    }
    await as('SENIOR')
      .post(`/api/lines/${lineB}/day-closes/${today}/close`)
      .expect(404);
    const future = await as('ADMIN')
      .post(`${base}/2099-01-01/close`)
      .expect(422);
    expect(future.body.code).toBe('DAY_NOT_STARTED');
    const blank = await as('ADMIN')
      .post(`${base}/${today}/reopen`, { reason: ' ' })
      .expect(400);
    expect(blank.body.details[0].field).toBe('reason');
    expect(
      await prisma.dayClose.count({
        where: { lineId: { in: [lineA, lineB] } },
      }),
    ).toBe(0);
  });

  it('handovers: Juniors and Seniors hand over, Seniors and Admins acknowledge, anyone may dispute their own; refusals write nothing', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      await as(role).get('/api/cash').expect(403);
      await as(role)
        .post('/api/handovers', {
          lineId: lineA,
          businessDate: today,
          counts: [],
        })
        .expect(403);
    }
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const position = await as(role).get('/api/cash').expect(200);
      expect(position.body).toMatchObject({ items: [], recent: [] });
    }
    await as('JUNIOR').get('/api/handovers').expect(403);
    await as('JUNIOR')
      .post('/api/handovers/hov_missing/acknowledge')
      .expect(403);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
      await as(role).get('/api/handovers').expect(200);
      await as(role).post('/api/handovers/hov_missing/acknowledge').expect(404);
    }
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      await as(role)
        .post('/api/handovers/hov_missing/dispute', { note: 'Short' })
        .expect(404);
    }

    const invalid = await as('JUNIOR')
      .post('/api/handovers', {
        lineId: lineA,
        businessDate: today,
        counts: [{ denomination: 3, count: -1 }],
      })
      .expect(400);
    expect(
      invalid.body.details.map((d: { field: string }) => d.field).sort(),
    ).toEqual(['counts.0.count', 'counts.0.denomination']);
    const nothing = await as('JUNIOR')
      .post('/api/handovers', {
        lineId: lineA,
        businessDate: today,
        counts: [],
      })
      .expect(422);
    expect(nothing.body.code).toBe('NOTHING_TO_HAND_OVER');
    await as('JUNIOR')
      .post('/api/handovers', {
        lineId: 'line_missing',
        businessDate: today,
        counts: [],
      })
      .expect(404);
    expect(
      await prisma.dayClose.count({
        where: { lineId: { in: [lineA, lineB] } },
      }),
    ).toBe(0);
  });
});
