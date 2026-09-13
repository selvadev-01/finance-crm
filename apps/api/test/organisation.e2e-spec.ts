import type { INestApplication } from '@nestjs/common';
import { organisationContract, type RouteDefinition } from '@repo/contracts';
import type { PrismaClient, StaffRole } from '@repo/db';
import { toBusinessDate } from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp, recordedAudit } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testCode,
} from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  type TestStaff,
} from './staff.js';

/**
 * M03 Organisation over HTTP (US-010…US-013): every route for every role, the
 * error shapes, pagination, and the contract's response shaping.
 */
describe('organisation (M03, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let sectorId: string;
  let lineId: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  const today = toBusinessDate(new Date());

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
    patch: (path: string, body?: object) =>
      http().patch(path).set('Cookie', cookies[role]).send(body),
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A']);
    organizationId = org.organization.id;
    sectorId = org.sector.id;
    lineId = org.lines[0]!.id;

    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, { organizationId, role });
      cookies[role] = await signIn(app, staff[role]);
    }
    // The Senior and Junior work Line A, so "own line" has something to show.
    await prisma.lineAssignment.createMany({
      data: [
        {
          staffProfileId: staff.SENIOR.staffProfileId,
          lineId,
          assignmentRole: 'SENIOR',
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          staffProfileId: staff.JUNIOR.staffProfileId,
          lineId,
          assignmentRole: 'JUNIOR',
          effectiveFrom: new Date('2026-01-01'),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  describe('RBAC: management routes are Admin and Super Admin only', () => {
    const managementRoutes: [string, RouteDefinition][] = [
      ['createSector', organisationContract.createSector],
      ['updateSector', organisationContract.updateSector],
      ['deactivateSector', organisationContract.deactivateSector],
      ['createLine', organisationContract.createLine],
      ['updateLine', organisationContract.updateLine],
      ['deactivateLine', organisationContract.deactivateLine],
      ['assignSenior', organisationContract.assignSenior],
      ['assignJunior', organisationContract.assignJunior],
    ];

    it.each(
      managementRoutes.flatMap(([name, route]) =>
        (['SENIOR', 'JUNIOR'] as const).map(
          (role) => [name, role, route] as const,
        ),
      ),
    )('%s is 403 for a %s', async (_name, role, route) => {
      const path = route.path
        .replace(':sectorId', sectorId)
        .replace(':lineId', lineId);
      const method = route.method.toLowerCase() as 'post' | 'patch';
      const response = await http()
        [method](path)
        .set('Cookie', cookies[role])
        .send({});
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    });

    it.each(managementRoutes)(
      '%s is 401 without a session',
      async (_name, route) => {
        const path = route.path
          .replace(':sectorId', sectorId)
          .replace(':lineId', lineId);
        const method = route.method.toLowerCase() as 'post' | 'patch';
        await http()[method](path).send({}).expect(401);
      },
    );
  });

  describe('sectors (US-010)', () => {
    it.each(['ADMIN', 'SUPER_ADMIN'] as const)(
      'an %s creates a sector: 201, only contract fields, audited with actor and IP',
      async (role) => {
        const code = testCode('SEC');
        const response = await as(role)
          .post('/api/sectors', { code, name: 'North' })
          .expect(201);

        expect(Object.keys(response.body).sort()).toEqual([
          'code',
          'id',
          'isActive',
          'name',
        ]);
        expect(response.body).toMatchObject({
          code,
          name: 'North',
          isActive: true,
        });
        expect(recordedAudit.at(-1)).toMatchObject({
          action: 'CREATE',
          entityTable: 'sector',
          entityId: response.body.id,
          actorUserId: staff[role].userId,
          ipAddress: expect.any(String),
        });
      },
    );

    it('a duplicate code is 409 SECTOR_CODE_TAKEN', async () => {
      const code = testCode('SEC');
      await as('ADMIN').post('/api/sectors', { code, name: 'One' }).expect(201);
      const response = await as('ADMIN')
        .post('/api/sectors', { code, name: 'Two' })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'SECTOR_CODE_TAKEN',
        details: [{ field: 'code', issue: 'is already in use' }],
      });
    });

    it('an invalid body is 400 with a detail per field', async () => {
      const response = await as('ADMIN')
        .post('/api/sectors', { code: 'has space', name: '' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.details.map((d: { field: string }) => d.field).sort(),
      ).toEqual(['code', 'name']);
    });

    it('renames, and refuses to deactivate while a line is active (422)', async () => {
      const renamed = await as('ADMIN')
        .patch(`/api/sectors/${sectorId}`, { name: 'Renamed' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        id: sectorId,
        name: 'Renamed',
        isActive: true,
      });
      const refused = await as('ADMIN')
        .post(`/api/sectors/${sectorId}/deactivation`)
        .expect(422);
      expect(refused.body.code).toBe('SECTOR_HAS_ACTIVE_LINES');
    });

    it('a sector in another organization is 404, identical to one that does not exist', async () => {
      const elsewhere = await createTestOrganization(prisma);
      const other = await as('ADMIN')
        .patch(`/api/sectors/${elsewhere.sector.id}`, { name: 'x' })
        .expect(404);
      const missing = await as('ADMIN')
        .patch('/api/sectors/does-not-exist', { name: 'x' })
        .expect(404);
      expect(other.body.code).toBe(missing.body.code);
      expect(other.body.message).toBe(missing.body.message);
    });

    it('a Senior lists only the sector of their own line; an Admin lists the organization', async () => {
      const extra = await as('ADMIN')
        .post('/api/sectors', { code: testCode('SEC'), name: 'Extra' })
        .expect(201);

      const senior = await as('SENIOR').get('/api/sectors').expect(200);
      expect(senior.body.data.map((s: { id: string }) => s.id)).toEqual([
        sectorId,
      ]);

      const admin = await as('ADMIN').get('/api/sectors?limit=200').expect(200);
      const ids = admin.body.data.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([sectorId, extra.body.id]));
    });
  });

  describe('detail reads (S-12, S-13)', () => {
    it('every role reads its own sector and line, including after deactivation', async () => {
      for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
        const sector = await as(role).get(`/api/sectors/${sectorId}`).expect(200);
        expect(sector.body).toMatchObject({ id: sectorId, isActive: true });
        const line = await as(role).get(`/api/lines/${lineId}`).expect(200);
        expect(line.body).toMatchObject({ id: lineId, sectorId });
      }

      const created = await as('ADMIN')
        .post('/api/lines', { sectorId, code: testCode('LN'), name: 'Closed' })
        .expect(201);
      await as('ADMIN')
        .post(`/api/lines/${created.body.id}/deactivation`)
        .expect(200);
      const inactive = await as('ADMIN')
        .get(`/api/lines/${created.body.id}`)
        .expect(200);
      expect(inactive.body.isActive).toBe(false);
    });

    it('another organization’s sector or line is 404, identical to a missing one; a Senior cannot read a line that is not theirs', async () => {
      const elsewhere = await createTestOrganization(prisma, ['Far']);
      for (const [path, missing] of [
        [`/api/sectors/${elsewhere.sector.id}`, '/api/sectors/does-not-exist'],
        [`/api/lines/${elsewhere.lines[0]!.id}`, '/api/lines/does-not-exist'],
      ] as const) {
        const other = await as('ADMIN').get(path).expect(404);
        const absent = await as('ADMIN').get(missing).expect(404);
        expect(other.body.code).toBe(absent.body.code);
        expect(other.body.message).toBe(absent.body.message);
      }

      const sibling = await as('ADMIN')
        .post('/api/lines', { sectorId, code: testCode('LN'), name: 'Sibling' })
        .expect(201);
      await as('SENIOR').get(`/api/lines/${sibling.body.id}`).expect(404);
      await as('JUNIOR').get(`/api/lines/${sibling.body.id}`).expect(404);
    });
  });

  describe('lines (US-011)', () => {
    it('creates a line, then deactivates it, and inactive lines are hidden unless asked for', async () => {
      const created = await as('ADMIN')
        .post('/api/lines', { sectorId, code: testCode('LN'), name: 'Line B' })
        .expect(201);
      const id = created.body.id as string;

      await as('ADMIN').post(`/api/lines/${id}/deactivation`).expect(200);

      const active = await as('ADMIN')
        .get(`/api/lines?sectorId=${sectorId}&limit=200`)
        .expect(200);
      const all = await as('ADMIN')
        .get(`/api/lines?sectorId=${sectorId}&limit=200&includeInactive=true`)
        .expect(200);
      expect(active.body.data.map((l: { id: string }) => l.id)).not.toContain(
        id,
      );
      expect(all.body.data.map((l: { id: string }) => l.id)).toContain(id);
    });

    it('a Junior lists only their own line', async () => {
      const response = await as('JUNIOR').get('/api/lines').expect(200);
      expect(response.body.data.map((l: { id: string }) => l.id)).toEqual([
        lineId,
      ]);
    });

    it('pages with a cursor, and refuses a cursor it did not issue', async () => {
      const org = await createTestOrganization(prisma, ['P1', 'P2', 'P3']);
      const admin = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role: 'ADMIN',
      });
      const cookie = await signIn(app, admin);

      const first = await http()
        .get('/api/lines?limit=2')
        .set('Cookie', cookie)
        .expect(200);
      expect(first.body).toMatchObject({
        hasMore: true,
        nextCursor: expect.any(String),
      });
      expect(first.body.data).toHaveLength(2);

      const second = await http()
        .get(`/api/lines?limit=2&cursor=${first.body.nextCursor}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(second.body).toMatchObject({ hasMore: false, nextCursor: null });
      expect(second.body.data).toHaveLength(1);

      const ids = [...first.body.data, ...second.body.data].map(
        (l: { id: string }) => l.id,
      );
      expect(new Set(ids)).toEqual(new Set(org.lines.map((l) => l.id)));

      const invalid = await http()
        .get('/api/lines?cursor=not-a-cursor!')
        .set('Cookie', cookie)
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_CURSOR');
    });

    it('a line in an inactive sector is 422 SECTOR_INACTIVE', async () => {
      const sector = await as('ADMIN')
        .post('/api/sectors', { code: testCode('SEC'), name: 'Closing' })
        .expect(201);
      await as('ADMIN')
        .post(`/api/sectors/${sector.body.id}/deactivation`)
        .expect(200);
      const response = await as('ADMIN')
        .post('/api/lines', {
          sectorId: sector.body.id,
          code: testCode('LN'),
          name: 'Nope',
        })
        .expect(422);
      expect(response.body.code).toBe('SECTOR_INACTIVE');
    });
  });

  describe('assignments (US-012, US-013)', () => {
    it('assigning a Junior effective today changes their scope on their next request', async () => {
      const line = await as('ADMIN')
        .post('/api/lines', { sectorId, code: testCode('LN'), name: 'Line C' })
        .expect(201);
      const junior = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      const juniorCookie = await signIn(app, junior);

      await http()
        .get('/api/lines')
        .set('Cookie', juniorCookie)
        .expect(200, { data: [], nextCursor: null, hasMore: false });

      const response = await as('ADMIN')
        .post(`/api/lines/${line.body.id}/junior-assignment`, {
          staffProfileId: junior.staffProfileId,
          effectiveFrom: today,
        })
        .expect(201);
      expect(response.body).toMatchObject({
        assignment: {
          lineId: line.body.id,
          effectiveFrom: today,
          effectiveTo: null,
        },
        closed: [],
        linesWithoutSenior: [],
      });

      const after = await http()
        .get('/api/lines')
        .set('Cookie', juniorCookie)
        .expect(200);
      expect(after.body.data.map((l: { id: string }) => l.id)).toEqual([
        line.body.id,
      ]);
    });

    it('assigning a new Senior closes the incumbent over HTTP and records both audit entries', async () => {
      const line = await as('ADMIN')
        .post('/api/lines', { sectorId, code: testCode('LN'), name: 'Line D' })
        .expect(201);
      const first = await createTestStaff(prisma, {
        organizationId,
        role: 'SENIOR',
      });
      const second = await createTestStaff(prisma, {
        organizationId,
        role: 'SENIOR',
      });
      await prisma.lineAssignment.create({
        data: {
          staffProfileId: first.staffProfileId,
          lineId: line.body.id,
          assignmentRole: 'SENIOR',
          effectiveFrom: new Date('2026-01-01'),
        },
      });
      const auditBefore = recordedAudit.length;

      const response = await as('ADMIN')
        .post(`/api/lines/${line.body.id}/senior-assignment`, {
          staffProfileId: second.staffProfileId,
          effectiveFrom: today,
        })
        .expect(201);

      expect(response.body.closed).toEqual([
        expect.objectContaining({
          staffProfileId: first.staffProfileId,
          effectiveTo: expect.any(String),
        }),
      ]);
      expect(recordedAudit.slice(auditBefore).map((row) => row.action)).toEqual(
        ['UPDATE', 'CREATE'],
      );
    });

    it('a malformed effective date is 400; a Junior into the Senior assignment is 422', async () => {
      const bad = await as('ADMIN')
        .post(`/api/lines/${lineId}/senior-assignment`, {
          staffProfileId: staff.JUNIOR.staffProfileId,
          effectiveFrom: '13/09/2026',
        })
        .expect(400);
      expect(bad.body.details).toEqual([
        expect.objectContaining({ field: 'effectiveFrom' }),
      ]);

      const mismatch = await as('ADMIN')
        .post(`/api/lines/${lineId}/senior-assignment`, {
          staffProfileId: staff.JUNIOR.staffProfileId,
          effectiveFrom: today,
        })
        .expect(422);
      expect(mismatch.body.code).toBe('STAFF_ROLE_MISMATCH');
    });
  });

  describe('staffing views (US-014, US-015)', () => {
    it('an Admin sees each line with today’s Senior, Junior count and customer count', async () => {
      await prisma.customer.create({
        data: {
          organizationId,
          sectorId,
          lineId,
          customerCode: testCode('CUS'),
          name: 'Staffing customer',
          mobile: '+919800000001',
          address: 'Address',
        },
      });
      const response = await as('ADMIN')
        .get('/api/staffing?limit=200')
        .expect(200);
      const lineA = response.body.data.find(
        (l: { lineId: string }) => l.lineId === lineId,
      );
      expect(lineA).toMatchObject({
        senior: {
          staffProfileId: staff.SENIOR.staffProfileId,
          name: 'Test Staff',
        },
        juniorCount: 1,
        customerCount: 1,
      });
    });

    it('a Senior sees only their own line; a Junior is refused', async () => {
      const senior = await as('SENIOR').get('/api/staffing').expect(200);
      expect(senior.body.data.map((l: { lineId: string }) => l.lineId)).toEqual(
        [lineId],
      );
      await as('JUNIOR').get('/api/staffing').expect(403);
    });

    it('lists a line’s assignment history, and who was responsible on a given date', async () => {
      const history = `/api/lines/${lineId}/assignments`;
      const all = await as('ADMIN').get(`${history}?limit=200`).expect(200);
      expect(all.body.data.length).toBeGreaterThanOrEqual(2);
      expect(all.body.data[0]).toHaveProperty('staffName');

      const before = await as('ADMIN')
        .get(`${history}?on=2025-12-31`)
        .expect(200);
      expect(before.body.data).toEqual([]);

      const onDay = await as('ADMIN')
        .get(`${history}?on=2026-03-14`)
        .expect(200);
      expect(
        onDay.body.data.map(
          (a: { staffProfileId: string }) => a.staffProfileId,
        ),
      ).toEqual(
        expect.arrayContaining([
          staff.SENIOR.staffProfileId,
          staff.JUNIOR.staffProfileId,
        ]),
      );
    });

    it('a Senior asking for another line’s history gets 404', async () => {
      const elsewhere = await createTestOrganization(prisma, ['Other line']);
      await as('SENIOR')
        .get(`/api/lines/${elsewhere.lines[0]!.id}/assignments`)
        .expect(404);
    });
  });
});
