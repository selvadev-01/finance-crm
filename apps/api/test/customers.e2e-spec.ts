import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
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
 * M04 onboarding over HTTP (US-020): the mandatory reference, the
 * duplicate-mobile warning, issued codes, and who may see which customer.
 */
describe('customers (M04, US-020, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let sectorId: string;
  let lineA: string;
  let lineB: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
  });

  // A mobile unlikely to collide with anything else in the shared schema.
  const uniqueMobile = () =>
    `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  const onboarding = (overrides: object = {}) => ({
    name: 'Lakshmi Narayanan',
    mobile: uniqueMobile(),
    address: '12 Market Road',
    lineId: lineA,
    references: [{ name: 'Ravi', mobile: '91234 56780', relation: 'brother' }],
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A', 'Line B']);
    organizationId = org.organization.id;
    sectorId = org.sector.id;
    lineA = org.lines[0]!.id;
    lineB = org.lines[1]!.id;

    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, { organizationId, role });
      cookies[role] = await signIn(app, staff[role]);
    }
    await prisma.lineAssignment.createMany({
      data: [
        {
          staffProfileId: staff.SENIOR.staffProfileId,
          lineId: lineA,
          assignmentRole: 'SENIOR',
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          staffProfileId: staff.JUNIOR.staffProfileId,
          lineId: lineA,
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

  it('onboards a customer: issued code, E.164 mobile, sector from the line, references kept, audited', async () => {
    const body = onboarding({ mobile: '98765 12345' });
    // The same number as typed in another form elsewhere in the schema would
    // trip the duplicate check; confirm so this test is about the happy path.
    const response = await as('ADMIN')
      .post('/api/customers', { ...body, confirmDuplicateMobile: true })
      .expect(201);

    expect(response.body).toMatchObject({
      name: 'Lakshmi Narayanan',
      mobile: '+919876512345',
      lineId: lineA,
      lineName: 'Line A',
      sectorId,
      status: 'ACTIVE',
      references: [
        {
          name: 'Ravi',
          mobile: '+919123456780',
          relation: 'brother',
          address: null,
        },
      ],
    });
    expect(response.body.customerCode).toMatch(/^CUS-\d{5,}$/);

    expect(
      recordedAudit.find((row) => row.entityId === response.body.id),
    ).toMatchObject({ entityTable: 'customer', action: 'CREATE' });
  });

  it('issues a new code for every customer', async () => {
    const first = await as('ADMIN')
      .post('/api/customers', onboarding())
      .expect(201);
    const second = await as('ADMIN')
      .post('/api/customers', onboarding())
      .expect(201);
    const number = (code: string) => Number(code.slice(4));
    expect(number(second.body.customerCode)).toBeGreaterThan(
      number(first.body.customerCode),
    );
  });

  it('a customer without a reference person is refused, naming the field', async () => {
    const response = await as('ADMIN')
      .post('/api/customers', onboarding({ references: [] }))
      .expect(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'references' }),
      ]),
    );
  });

  it('a mobile number already on a customer is warned with 409, then accepted when confirmed', async () => {
    const mobile = uniqueMobile();
    const existing = await as('ADMIN')
      .post('/api/customers', onboarding({ mobile, name: 'First' }))
      .expect(201);

    const warned = await as('ADMIN')
      .post('/api/customers', onboarding({ mobile, name: 'Second' }))
      .expect(409);
    expect(warned.body.code).toBe('DUPLICATE_MOBILE');

    const confirmed = await as('ADMIN')
      .post(
        '/api/customers',
        onboarding({ mobile, name: 'Second', confirmDuplicateMobile: true }),
      )
      .expect(201);

    // The form finds who already has the number by listing on it.
    const sharing = await as('ADMIN')
      .get(`/api/customers?mobile=${encodeURIComponent(`+91${mobile}`)}`)
      .expect(200);
    expect(sharing.body.data.map((c: { id: string }) => c.id).sort()).toEqual(
      [existing.body.id, confirmed.body.id].sort(),
    );
  });

  it('an inactive line is 422; a line in another organization is 404', async () => {
    const closed = await prisma.line.create({
      data: {
        organizationId,
        sectorId,
        code: testCode('LN'),
        name: 'Closed',
        isActive: false,
      },
    });
    const inactive = await as('ADMIN')
      .post('/api/customers', onboarding({ lineId: closed.id }))
      .expect(422);
    expect(inactive.body.code).toBe('LINE_INACTIVE');

    const elsewhere = await createTestOrganization(prisma, ['Far']);
    await as('ADMIN')
      .post('/api/customers', onboarding({ lineId: elsewhere.lines[0]!.id }))
      .expect(404);
  });

  it('a Senior or Junior cannot onboard a customer', async () => {
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const response = await as(role)
        .post('/api/customers', onboarding())
        .expect(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    }
  });

  it('Seniors and Juniors see only their line’s customers; another line’s customer is 404, identical to a missing one', async () => {
    const onA = await as('ADMIN')
      .post('/api/customers', onboarding({ name: 'On A' }))
      .expect(201);
    const onB = await as('ADMIN')
      .post('/api/customers', onboarding({ name: 'On B', lineId: lineB }))
      .expect(201);

    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const listed = await as(role).get('/api/customers?limit=200').expect(200);
      const ids = listed.body.data.map((c: { id: string }) => c.id);
      expect(ids).toContain(onA.body.id);
      expect(ids).not.toContain(onB.body.id);
      expect(
        new Set(listed.body.data.map((c: { lineId: string }) => c.lineId)),
      ).toEqual(new Set([lineA]));

      await as(role).get(`/api/customers/${onA.body.id}`).expect(200);
      const hidden = await as(role)
        .get(`/api/customers/${onB.body.id}`)
        .expect(404);
      const missing = await as(role)
        .get('/api/customers/does-not-exist')
        .expect(404);
      expect(hidden.body).toMatchObject({
        code: missing.body.code,
        message: missing.body.message,
      });
    }

    const admin = await as('SUPER_ADMIN')
      .get(`/api/customers?lineId=${lineB}&limit=200`)
      .expect(200);
    expect(admin.body.data.map((c: { id: string }) => c.id)).toContain(
      onB.body.id,
    );
  });
});
