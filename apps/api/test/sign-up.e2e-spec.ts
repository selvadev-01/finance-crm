import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@repo/db';
import { randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { SignUpRateLimiter } from '../src/identity/sign-up-rate-limiter.js';
import { createTestApp, recordedAudit } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testCode,
  testEmail,
} from './database.js';
import { signIn } from './staff.js';

/**
 * US-006 over HTTP: the owner of a new business signs up, gets a slug
 * generated from the business name, and signs in as its Super Admin. Every
 * row is run-tagged — the organization by name, the owner by email — and the
 * audit entries go to `recordedAudit`, so `deleteTestRunData` leaves nothing
 * behind.
 */
describe('organization sign-up (US-006, e2e)', () => {
  let prisma: PrismaClient;
  let app: INestApplication<Server>;

  const body = (overrides: Record<string, unknown> = {}) => ({
    organizationName: testCode('ORG'),
    name: 'Owner',
    email: testEmail('owner'),
    phone: `9${randomInt(100_000_000, 999_999_999)}`,
    password: 'the-owners-own-password',
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('creates the organization with a generated slug, and the owner signs in straight to Super Admin', async () => {
    const input = body({ email: testEmail('Owner').toUpperCase() });
    const response = await request(app.getHttpServer())
      .post('/api/organizations')
      .send(input)
      .expect(201);
    expect(response.body).toEqual({
      organizationId: expect.any(String),
      staffProfileId: expect.any(String),
      // The run-tagged name `ORG-run-…`, slugged: lower-case, hyphen-separated.
      slug: expect.stringMatching(/^org-run-[a-z0-9]+(-[a-z0-9]+)*$/),
    });
    expect(
      recordedAudit.filter(
        (row) => row.organizationId === response.body.organizationId,
      ),
    ).toHaveLength(2);

    // The sign-in link resolves to the business name, without a session.
    const link = await request(app.getHttpServer())
      .get(`/api/organizations/${response.body.slug}`)
      .expect(200);
    expect(link.body).toEqual({
      slug: response.body.slug,
      name: input.organizationName,
    });

    // Typed in capitals, stored lower-case, and signs in either way.
    const cookie = await signIn(app, {
      email: String(input.email).toLowerCase(),
      password: String(input.password),
    });
    const me = await request(app.getHttpServer())
      .get('/api/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toMatchObject({
      staffProfileId: response.body.staffProfileId,
      role: 'SUPER_ADMIN',
      currentLineId: null,
      organization: { name: input.organizationName, slug: response.body.slug },
    });
    // An empty organization, and only its own.
    const sectors = await request(app.getHttpServer())
      .get('/api/sectors')
      .set('Cookie', cookie)
      .expect(200);
    expect(sectors.body.data).toEqual([]);
  });

  it('answers 404 for a sign-in link no business uses, and 400 for one that is not a slug', async () => {
    const missing = await request(app.getHttpServer())
      .get(`/api/organizations/${testCode('no-such').toLowerCase()}`)
      .expect(404);
    expect(missing.body.code).toBe('ORGANIZATION_NOT_FOUND');
    await request(app.getHttpServer())
      .get('/api/organizations/Not%20A%20Slug')
      .expect(400);
  });

  it('validates the form: a short password and a bad mobile are 400 with field details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/organizations')
      .send(body({ password: 'short', phone: '12345' }))
      .expect(400);
    expect(
      (response.body.details as { field: string }[]).map((d) => d.field),
    ).toEqual(expect.arrayContaining(['password', 'phone']));
  });

  it('refuses a taken email with 409, naming the field', async () => {
    const first = body();
    await request(app.getHttpServer())
      .post('/api/organizations')
      .send(first)
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/organizations')
      .send(body({ email: first.email }))
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'EMAIL_TAKEN',
      details: [{ field: 'email', issue: 'already has an account' }],
    });
  });

  it('rate-limits sign-up per address with 429, before creating anything', async () => {
    const limited = await createTestApp({
      overrides: [
        [
          SignUpRateLimiter,
          new SignUpRateLimiter({ limit: 1, windowMs: 60_000 }),
        ],
      ],
    });
    try {
      // A malformed form is refused by validation and does not use an attempt.
      const first = body();
      await request(limited.getHttpServer())
        .post('/api/organizations')
        .send({ ...first, password: 'x' })
        .expect(400);
      await request(limited.getHttpServer())
        .post('/api/organizations')
        .send(first)
        .expect(201);
      const input = body();
      const response = await request(limited.getHttpServer())
        .post('/api/organizations')
        .send(input)
        .expect(429);
      expect(response.body.code).toBe('SIGN_UP_RATE_LIMITED');
      expect(await prisma.user.count({ where: { email: input.email } })).toBe(
        0,
      );
    } finally {
      await limited.close();
    }
  });
});
