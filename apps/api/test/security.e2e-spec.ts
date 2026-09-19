import type { INestApplication } from '@nestjs/common';
import type { Organization, PrismaClient, StaffRole } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp, recordedSecurityEvents } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * The security log over HTTP (M13, ADR-0014).
 *
 * Two halves. The **write** half asserts that a real refused request reaches
 * the recorder with the right actor, route, target and code; the rows go to
 * memory (`test/app.ts`) because `rbac-matrix.e2e-spec.ts` refuses every
 * protected route for every role on every run, and a tier that wrote them all
 * would put several hundred rows a run into the shared development schema.
 * The real insert is Tier 1's (`test/security/security-event.recorder.spec.ts`).
 *
 * The **read** half needs rows, so it inserts them directly against a
 * run-tagged organization — `security_event` accepts DELETE, and
 * `deleteTestRunData` takes them out again.
 */
describe('security log (M13, ADR-0014, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organization: Organization;
  const cookies = {} as Record<StaffRole, string>;
  const users = {} as Record<StaffRole, string>;
  let owner: { staffProfileId: string; userId: string };

  const as = (role: StaffRole) => (path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookies[role]);

  /** Only what this test caused — the array is shared across the file. */
  function since(mark: number) {
    return recordedSecurityEvents.slice(mark);
  }

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const created = await createTestOrganization(prisma, ['Line A']);
    organization = created.organization;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      const staff = await createTestStaff(prisma, {
        organizationId: organization.id,
        role,
      });
      cookies[role] = await signIn(app, staff);
      users[role] = staff.userId;
      if (role === 'SUPER_ADMIN') owner = staff;
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  describe('what gets recorded', () => {
    it('records a Junior reaching for a route their role does not hold, with the permission and the route', async () => {
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .post('/api/staff')
        .set('Cookie', cookies.JUNIOR)
        .send({})
        .expect(403);

      expect(since(mark)).toMatchObject([
        {
          organizationId: organization.id,
          actorUserId: users.JUNIOR,
          actorRole: 'JUNIOR',
          kind: 'PERMISSION_DENIED',
          code: 'PERMISSION_DENIED',
          status: 403,
          method: 'POST',
          path: '/api/staff',
          detail: { permission: 'staff.create' },
        },
      ]);
    });

    it('records the id a denied request named, so a repeated probe shows who was being aimed at', async () => {
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .post(`/api/staff/${owner.staffProfileId}/role`)
        .set('Cookie', cookies.ADMIN)
        .send({ role: 'JUNIOR' })
        .expect(403);

      expect(since(mark)).toMatchObject([
        {
          actorRole: 'ADMIN',
          code: 'PERMISSION_DENIED',
          path: '/api/staff/:staffProfileId/role',
          targetId: owner.staffProfileId,
          detail: { permission: 'staff.changeRole' },
        },
      ]);
    });

    it('records an Admin creating a Super Admin, and keeps none of the identity they invented', async () => {
      const mark = recordedSecurityEvents.length;
      const body = {
        name: 'Invented Person',
        email: 'invented@security.rasi.test',
        phone: '+919000000123',
        role: 'SUPER_ADMIN',
      };

      const response = await request(app.getHttpServer())
        .post('/api/staff')
        .set('Cookie', cookies.ADMIN)
        .send(body)
        .expect(403);
      expect(response.body.code).toBe('ROLE_ABOVE_OWN');

      const [row] = since(mark);
      expect(row).toMatchObject({
        kind: 'RANK_GUARD',
        code: 'ROLE_ABOVE_OWN',
        status: 403,
        detail: { attemptedRole: 'SUPER_ADMIN' },
      });
      const written = JSON.stringify(row);
      for (const value of [body.name, body.email, body.phone]) {
        expect(written).not.toContain(value);
      }
    });

    it('records an Admin trying to suspend the owner', async () => {
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .post(`/api/staff/${owner.staffProfileId}/status`)
        .set('Cookie', cookies.ADMIN)
        .send({ status: 'SUSPENDED', acknowledgeOnDuty: true })
        .expect(403);

      expect(since(mark)).toMatchObject([
        {
          kind: 'RANK_GUARD',
          code: 'CANNOT_MANAGE_HIGHER_ROLE',
          path: '/api/staff/:staffProfileId/status',
          targetTable: 'staff_profile',
          targetId: owner.staffProfileId,
          detail: { targetRole: 'SUPER_ADMIN' },
        },
      ]);
    });

    it('records a staff id from another business, and the caller cannot tell it apart from a missing one', async () => {
      const elsewhere = await createTestOrganization(prisma);
      const theirs = await createTestStaff(prisma, {
        organizationId: elsewhere.organization.id,
        role: 'JUNIOR',
      });
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .patch(`/api/staff/${theirs.staffProfileId}`)
        .set('Cookie', cookies.ADMIN)
        .send({ name: 'Renamed', phone: '+919000000456' })
        .expect(404);

      expect(since(mark)).toMatchObject([
        {
          kind: 'OUT_OF_SCOPE',
          code: 'STAFF_NOT_FOUND',
          status: 404,
          targetId: theirs.staffProfileId,
        },
      ]);
    });

    it('records the settings locks, which only the owner can even reach', async () => {
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .patch('/api/settings/organisation.timezone')
        .set('Cookie', cookies.SUPER_ADMIN)
        .send({ value: 'UTC' })
        .expect(422);
      await request(app.getHttpServer())
        .patch('/api/settings/account.interestRate')
        .set('Cookie', cookies.SUPER_ADMIN)
        .send({ value: '12' })
        .expect(404);

      expect(since(mark)).toMatchObject([
        {
          kind: 'SETTING_LOCKED',
          code: 'SETTING_IMMUTABLE',
          status: 422,
          path: '/api/settings/:key',
          targetTable: 'setting',
          targetId: 'organisation.timezone',
        },
        { kind: 'OUT_OF_SCOPE', code: 'SETTING_NOT_FOUND', status: 404 },
      ]);
    });

    it('records nothing for an ordinary refusal — an invalid body is not an attempt', async () => {
      const mark = recordedSecurityEvents.length;

      await request(app.getHttpServer())
        .post('/api/staff')
        .set('Cookie', cookies.ADMIN)
        .send({ name: '', email: 'not-an-email', phone: 'x', role: 'JUNIOR' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/settings/account.defaultTermDays')
        .set('Cookie', cookies.SUPER_ADMIN)
        .send({ value: 'ninety' })
        .expect(400);

      expect(since(mark)).toEqual([]);
    });
  });

  describe('reading it (S-31)', () => {
    beforeAll(async () => {
      await prisma.securityEvent.createMany({
        data: [
          {
            organizationId: organization.id,
            actorUserId: users.ADMIN,
            actorRole: 'ADMIN',
            kind: 'RANK_GUARD',
            code: 'ROLE_ABOVE_OWN',
            status: 403,
            method: 'POST',
            path: '/api/staff',
            detail: { attemptedRole: 'SUPER_ADMIN' },
            createdAt: new Date('2026-09-10T04:00:00Z'),
          },
          {
            organizationId: organization.id,
            actorUserId: users.JUNIOR,
            actorRole: 'JUNIOR',
            kind: 'PERMISSION_DENIED',
            code: 'PERMISSION_DENIED',
            status: 403,
            method: 'GET',
            path: '/api/audit-log',
            createdAt: new Date('2026-09-11T04:00:00Z'),
          },
        ],
      });
    });

    it('is for Admins and Super Admins; Seniors and Juniors get 403 and no session gets 401', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
        const page = await as(role)('/api/security-events').expect(200);
        expect(page.body.data.length).toBeGreaterThanOrEqual(2);
      }
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        await as(role)('/api/security-events').expect(403);
      }
      await request(app.getHttpServer())
        .get('/api/security-events')
        .expect(401);
    });

    it('answers newest first, naming the person who made each attempt', async () => {
      const page = await as('ADMIN')('/api/security-events').expect(200);
      const seeded = page.body.data.filter(
        (row: { actor: { userId: string } }) =>
          [users.ADMIN, users.JUNIOR].includes(row.actor.userId),
      );
      expect(seeded[0]).toMatchObject({
        code: 'PERMISSION_DENIED',
        actor: { userId: users.JUNIOR, name: 'Test Staff', role: 'JUNIOR' },
        path: '/api/audit-log',
      });
      expect(seeded[1]).toMatchObject({
        code: 'ROLE_ABOVE_OWN',
        detail: { attemptedRole: 'SUPER_ADMIN' },
      });
    });

    it('filters by staff member, kind, code and date, and refuses a reversed range', async () => {
      const byActor = await as('ADMIN')(
        `/api/security-events?actorUserId=${users.JUNIOR}`,
      ).expect(200);
      expect(
        byActor.body.data.every(
          (row: { actor: { userId: string } }) =>
            row.actor.userId === users.JUNIOR,
        ),
      ).toBe(true);

      const byKind = await as('ADMIN')(
        '/api/security-events?kind=RANK_GUARD&code=ROLE_ABOVE_OWN',
      ).expect(200);
      expect(
        byKind.body.data.every(
          (row: { kind: string }) => row.kind === 'RANK_GUARD',
        ),
      ).toBe(true);

      const byDate = await as('ADMIN')(
        '/api/security-events?from=2026-09-10&to=2026-09-10',
      ).expect(200);
      expect(byDate.body.data).toHaveLength(1);
      expect(byDate.body.data[0].code).toBe('ROLE_ABOVE_OWN');

      const invalid = await as('ADMIN')(
        '/api/security-events?kind=SNOOPING&from=5-1-2026',
      ).expect(400);
      expect(
        invalid.body.details.map((d: { field: string }) => d.field).sort(),
      ).toEqual(['from', 'kind']);

      const reversed = await as('ADMIN')(
        '/api/security-events?from=2026-01-06&to=2026-01-05',
      ).expect(400);
      expect(reversed.body.code).toBe('INVALID_DATE_RANGE');
    });

    it('never shows another business’s attempts', async () => {
      const elsewhere = await createTestOrganization(prisma);
      const theirAdmin = await createTestStaff(prisma, {
        organizationId: elsewhere.organization.id,
        role: 'ADMIN',
      });
      await prisma.securityEvent.create({
        data: {
          organizationId: elsewhere.organization.id,
          actorUserId: theirAdmin.userId,
          actorRole: 'ADMIN',
          kind: 'SELF_GUARD',
          code: 'CANNOT_CHANGE_OWN_ROLE',
          status: 422,
          method: 'POST',
          path: '/api/staff/:staffProfileId/role',
        },
      });

      const page = await as('ADMIN')(
        '/api/security-events?code=CANNOT_CHANGE_OWN_ROLE',
      ).expect(200);
      expect(page.body.data).toEqual([]);
    });
  });
});
