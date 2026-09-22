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
    patch: (path: string, body?: object) =>
      http().patch(path).set('Cookie', cookies[role]).send(body),
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

  describe('customer 360 (US-022)', () => {
    it('reports no accounts and the line’s staff for a newly onboarded customer', async () => {
      const customer = (
        await as('ADMIN')
          .post('/api/customers', onboarding({ name: 'Fresh Start' }))
          .expect(201)
      ).body as { id: string };

      const overview = await as('ADMIN')
        .get(`/api/customers/${customer.id}/overview`)
        .expect(200);
      expect(overview.body).toMatchObject({
        accounts: { active: 0, completed: 0, other: 0 },
        outstandingTotal: '0.00',
        collectedTotal: '0.00',
      });
      // The Senior and Junior assigned to Line A in this suite's setup. Every
      // test user carries the same display name, so the roles are the point.
      expect(overview.body.staff.seniorName).toBe('Test Staff');
      expect(overview.body.staff.juniorNames).toEqual(['Test Staff']);

      const history = await as('ADMIN')
        .get(`/api/customers/${customer.id}/collections`)
        .expect(200);
      expect(history.body).toMatchObject({ data: [], hasMore: false });
    });

    it('another line’s customer is 404 for a Senior and a Junior, on both the overview and the history', async () => {
      const onB = (
        await as('ADMIN')
          .post('/api/customers', onboarding({ name: 'On B', lineId: lineB }))
          .expect(201)
      ).body as { id: string };

      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        await as(role).get(`/api/customers/${onB.id}/overview`).expect(404);
        await as(role).get(`/api/customers/${onB.id}/collections`).expect(404);
      }
      await as('SUPER_ADMIN')
        .get(`/api/customers/${onB.id}/overview`)
        .expect(200);
    });

    it('refuses a page cursor it did not issue', async () => {
      const customer = (
        await as('ADMIN').post('/api/customers', onboarding()).expect(201)
      ).body as { id: string };
      const response = await as('ADMIN')
        .get(`/api/customers/${customer.id}/collections?cursor=not-a-cursor`)
        .expect(400);
      expect(response.body.code).toBe('INVALID_CURSOR');
    });
  });

  describe('transferring a customer (US-023)', () => {
    const onboard = async (overrides: object = {}) =>
      (
        await as('ADMIN')
          .post('/api/customers', onboarding(overrides))
          .expect(201)
      ).body as { id: string; lineId: string; sectorId: string };

    it('moves the customer and their sector to the new line, records the period, and audits it', async () => {
      const customer = await onboard({ name: 'Moving Customer' });
      // Placed on Line A's visiting order (US-040)…
      await prisma.customer.update({
        where: { id: customer.id },
        data: { routePosition: 1 },
      });

      const moved = await as('ADMIN')
        .post(`/api/customers/${customer.id}/line-transfer`, {
          lineId: lineB,
          reason: 'Moved house',
        })
        .expect(200);
      expect(moved.body).toMatchObject({
        id: customer.id,
        lineId: lineB,
        lineName: 'Line B',
        sectorId,
      });
      // …and waiting at the end of Line B's until someone places it there.
      expect(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: customer.id },
          })
        ).routePosition,
      ).toBeNull();

      const history = await as('ADMIN')
        .get(`/api/customers/${customer.id}/line-transfers`)
        .expect(200);
      // Newest first: the open period on Line B, then the closed one on Line A.
      expect(history.body.data).toMatchObject([
        { lineId: lineB, effectiveTo: null, reason: 'Moved house' },
        { lineId: lineA, effectiveTo: expect.any(String) },
      ]);
      expect(history.body.data[0].effectiveFrom).toBe(
        history.body.data[1].effectiveTo,
      );

      expect(
        recordedAudit.find(
          (row) => row.entityId === customer.id && row.action === 'UPDATE',
        ),
      ).toMatchObject({
        entityTable: 'customer',
        before: { lineId: lineA },
        after: { lineId: lineB },
      });
    });

    it('the line they are already on is 422, and so is an inactive line', async () => {
      const customer = await onboard();
      const same = await as('ADMIN')
        .post(`/api/customers/${customer.id}/line-transfer`, { lineId: lineA })
        .expect(422);
      expect(same.body.code).toBe('SAME_LINE');

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
        .post(`/api/customers/${customer.id}/line-transfer`, {
          lineId: closed.id,
        })
        .expect(422);
      expect(inactive.body.code).toBe('LINE_INACTIVE');
    });

    it('a line in another organization is 404 and the customer does not move', async () => {
      const customer = await onboard();
      const elsewhere = await createTestOrganization(prisma, ['Far']);
      await as('ADMIN')
        .post(`/api/customers/${customer.id}/line-transfer`, {
          lineId: elsewhere.lines[0]!.id,
        })
        .expect(404);

      const unchanged = await as('ADMIN')
        .get(`/api/customers/${customer.id}`)
        .expect(200);
      expect(unchanged.body.lineId).toBe(lineA);
    });

    it('a Senior or Junior cannot transfer, but sees the history of a customer on their line', async () => {
      const customer = await onboard();
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const refused = await as(role)
          .post(`/api/customers/${customer.id}/line-transfer`, {
            lineId: lineB,
          })
          .expect(403);
        expect(refused.body.code).toBe('PERMISSION_DENIED');

        const history = await as(role)
          .get(`/api/customers/${customer.id}/line-transfers`)
          .expect(200);
        expect(history.body.data).toMatchObject([
          { lineId: lineA, effectiveTo: null },
        ]);
      }
    });

    it('the history of a customer on another line is 404, identical to a missing one', async () => {
      const onB = await onboard({ name: 'On B', lineId: lineB });
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const hidden = await as(role)
          .get(`/api/customers/${onB.id}/line-transfers`)
          .expect(404);
        const missing = await as(role)
          .get('/api/customers/does-not-exist/line-transfers')
          .expect(404);
        expect(hidden.body).toMatchObject({
          code: missing.body.code,
          message: missing.body.message,
        });
      }
    });
  });

  describe('searching customers (US-024)', () => {
    const search = async (role: StaffRole, q: string) =>
      (
        await as(role)
          .get(`/api/customers?limit=200&q=${encodeURIComponent(q)}`)
          .expect(200)
      ).body.data.map((c: { id: string }) => c.id) as string[];

    it('finds a customer by any part of the name in any case, by code whole or as a number, and by mobile as typed', async () => {
      const mobile = uniqueMobile();
      const found = (
        await as('ADMIN')
          .post(
            '/api/customers',
            onboarding({ name: 'Parvathi Sundaram', mobile }),
          )
          .expect(201)
      ).body as { id: string; customerCode: string };
      const other = (
        await as('ADMIN')
          .post('/api/customers', onboarding({ name: 'Other Person' }))
          .expect(201)
      ).body as { id: string };

      const number = String(Number(found.customerCode.slice(4)));
      const spaced = `${mobile.slice(0, 5)} ${mobile.slice(5)}`;
      for (const q of [
        'sundar',
        'PARVATHI',
        found.customerCode,
        found.customerCode.toLowerCase(),
        number,
        spaced,
        `+91${mobile}`,
      ]) {
        const ids = await search('ADMIN', q);
        expect(ids, q).toContain(found.id);
        expect(ids, q).not.toContain(other.id);
      }
    });

    it('a part of a mobile or a code does not match — those are exact', async () => {
      const mobile = uniqueMobile();
      const customer = (
        await as('ADMIN')
          .post('/api/customers', onboarding({ name: 'Exact Only', mobile }))
          .expect(201)
      ).body as { id: string };
      expect(await search('ADMIN', mobile.slice(0, 6))).not.toContain(
        customer.id,
      );
    });

    it('search stays within scope: a Senior or Junior never finds another line’s customer, even by exact code', async () => {
      const elsewhere = (
        await as('ADMIN')
          .post(
            '/api/customers',
            onboarding({ name: 'Kaveri Elsewhere', lineId: lineB }),
          )
          .expect(201)
      ).body as { id: string; customerCode: string };

      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        expect(await search(role, 'Kaveri')).not.toContain(elsewhere.id);
        expect(await search(role, elsewhere.customerCode)).not.toContain(
          elsewhere.id,
        );
      }
      expect(await search('SUPER_ADMIN', 'kaveri')).toContain(elsewhere.id);
    });

    it('an over-long search is refused naming the field', async () => {
      const response = await as('ADMIN')
        .get(`/api/customers?q=${'a'.repeat(81)}`)
        .expect(400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'q' })]),
      );
    });
  });

  describe('editing a customer (US-021)', () => {
    type Detail = {
      id: string;
      mobile: string;
      lineId: string;
      references: { id: string; name: string; mobile: string }[];
    };

    /** The form's body for an existing customer, with overrides. */
    const editing = (customer: Detail, overrides: object = {}) => ({
      name: 'Lakshmi N.',
      mobile: customer.mobile,
      address: '14 Market Road',
      status: 'ACTIVE',
      references: customer.references.map(({ id, name, mobile }) => ({
        id,
        name,
        mobile,
      })),
      ...overrides,
    });

    const onboard = async (overrides: object = {}): Promise<Detail> =>
      (
        await as('ADMIN')
          .post('/api/customers', onboarding(overrides))
          .expect(201)
      ).body;

    it('edits details, status and references — kept, changed, added and removed — and audits before and after', async () => {
      const customer = await onboard({
        notes: 'Shop closes at 6',
        references: [
          { name: 'Ravi', mobile: '91234 56780', relation: 'brother' },
          { name: 'Meena', mobile: '91234 56781' },
        ],
      });
      const [ravi, meena] = customer.references;

      const response = await as('SUPER_ADMIN')
        .patch(
          `/api/customers/${customer.id}`,
          editing(customer, {
            status: 'INACTIVE',
            alternateMobile: '81234 56789',
            references: [
              { id: ravi!.id, name: 'Ravi Kumar', mobile: '91234 56780' },
              { name: 'Suresh', mobile: '91234 56782', relation: 'neighbour' },
            ],
          }),
        )
        .expect(200);

      expect(response.body).toMatchObject({
        id: customer.id,
        name: 'Lakshmi N.',
        address: '14 Market Road',
        alternateMobile: '+918123456789',
        // Omitted optional fields are cleared, as the form sent them.
        notes: null,
        status: 'INACTIVE',
        // The line never moves on an edit (US-023 is the transfer).
        lineId: customer.lineId,
      });
      expect(response.body.references).toEqual([
        {
          id: ravi!.id,
          name: 'Ravi Kumar',
          mobile: '+919123456780',
          relation: null,
          address: null,
        },
        expect.objectContaining({ name: 'Suresh', relation: 'neighbour' }),
      ]);
      expect(
        response.body.references.map((r: { id: string }) => r.id),
      ).not.toContain(meena!.id);

      const entry = recordedAudit.find(
        (row) => row.entityId === customer.id && row.action === 'UPDATE',
      );
      expect(entry).toMatchObject({
        entityTable: 'customer',
        before: { name: 'Lakshmi Narayanan', status: 'ACTIVE' },
        after: { name: 'Lakshmi N.', status: 'INACTIVE' },
      });
    });

    it('keeping the same mobile is not a duplicate; changing to a shared one is warned with 409, then accepted when confirmed', async () => {
      const taken = uniqueMobile();
      await onboard({ mobile: taken, name: 'Has the number' });
      const customer = await onboard();

      await as('ADMIN')
        .patch(`/api/customers/${customer.id}`, editing(customer))
        .expect(200);

      const warned = await as('ADMIN')
        .patch(
          `/api/customers/${customer.id}`,
          editing(customer, { mobile: taken }),
        )
        .expect(409);
      expect(warned.body.code).toBe('DUPLICATE_MOBILE');

      const confirmed = await as('ADMIN')
        .patch(
          `/api/customers/${customer.id}`,
          editing(customer, { mobile: taken, confirmDuplicateMobile: true }),
        )
        .expect(200);
      expect(confirmed.body.mobile).toBe(`+91${taken}`);
    });

    it('removing every reference is refused, naming the field', async () => {
      const customer = await onboard();
      const response = await as('ADMIN')
        .patch(
          `/api/customers/${customer.id}`,
          editing(customer, { references: [] }),
        )
        .expect(400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'references' }),
        ]),
      );
    });

    it('another customer’s reference id is 422 and leaves that reference untouched', async () => {
      const customer = await onboard();
      const other = await onboard();
      const theirs = other.references[0]!;

      const response = await as('ADMIN')
        .patch(
          `/api/customers/${customer.id}`,
          editing(customer, {
            references: [
              { id: theirs.id, name: 'Hijacked', mobile: theirs.mobile },
            ],
          }),
        )
        .expect(422);
      expect(response.body.code).toBe('UNKNOWN_REFERENCE');

      const unchanged = await as('ADMIN')
        .get(`/api/customers/${other.id}`)
        .expect(200);
      expect(unchanged.body.references[0]).toMatchObject({
        id: theirs.id,
        name: theirs.name,
      });
    });

    it('a Senior or Junior cannot edit, even on their own line; another organization’s customer is 404', async () => {
      const customer = await onboard();
      for (const role of ['SENIOR', 'JUNIOR'] as const) {
        const response = await as(role)
          .patch(`/api/customers/${customer.id}`, editing(customer))
          .expect(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      }

      const elsewhere = await createTestOrganization(prisma, ['Far']);
      const foreign = await prisma.customer.create({
        data: {
          organizationId: elsewhere.organization.id,
          customerCode: testCode('CUS'),
          name: 'Elsewhere',
          mobile: `+91${uniqueMobile()}`,
          address: 'Far away',
          lineId: elsewhere.lines[0]!.id,
          sectorId: elsewhere.sector.id,
          references: { create: [{ name: 'Ref', mobile: '+919123456780' }] },
        },
        include: { references: true },
      });
      await as('ADMIN')
        .patch(`/api/customers/${foreign.id}`, editing(foreign))
        .expect(404);
    });
  });
});
