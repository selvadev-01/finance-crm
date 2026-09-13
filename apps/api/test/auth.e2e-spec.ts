import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import {
  signInAudit,
  signInAuditRow,
  UNKNOWN_USER,
} from '../src/auth/sign-in-audit.js';
import { STAFF_NOT_ACTIVE_MESSAGE } from '../src/auth/sign-in-policy.js';
import { createTestApp, recordedSignIns } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testEmail,
} from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  TEST_PASSWORD,
} from './staff.js';

/**
 * Authentication over HTTP: the smoke test for the settings that fail
 * silently when a refactor drops them, and US-001 staff sign-in.
 *
 * The smoke half guards (authentication.md):
 *   - `bodyParser: false` on the Nest application. Better Auth reads the raw
 *     request body; Nest's parser consumes the stream first, and every auth
 *     route then breaks with nothing pointing at the cause.
 *   - `AuthModule.forRoot({ auth })` with the object argument.
 * If either regresses, sign-in stops returning a session cookie.
 */
describe('authentication (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;

  const http = () => request(app.getHttpServer());
  const attempt = (email: string, password: string) =>
    http()
      .post('/api/auth/sign-in/email')
      .set('User-Agent', 'rasi-e2e')
      .send({ email, password });
  const lastAttempt = () => recordedSignIns.at(-1);

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    organizationId = (await createTestOrganization(prisma)).organization.id;
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  describe('smoke', () => {
    it('signs an ACTIVE staff member in with a 30-day HttpOnly session cookie', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      const response = await attempt(staff.email, staff.password).expect(200);

      const cookies = String(response.headers['set-cookie']);
      expect(cookies).toContain('better-auth.session_token');
      // 30-day rolling session, deliberately long because a Junior may be
      // offline for weeks (M01, authentication.md).
      expect(cookies).toContain('Max-Age=2592000');
      expect(cookies).toContain('HttpOnly');
    });

    it('the session cookie resolves the signed-in user', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'SENIOR',
      });
      const cookie = await signIn(app, staff);

      const session = await http()
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);
      expect(session.body?.user?.email).toBe(staff.email);
    });

    it('cleanup removes the users and sessions this run created', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      await signIn(app, staff);
      const where = { email: staff.email };
      expect(await prisma.session.count({ where: { user: where } })).toBe(1);

      await prisma.user.deleteMany({ where });

      expect(await prisma.user.count({ where })).toBe(0);
      expect(await prisma.session.count({ where: { user: where } })).toBe(0);
    });
  });

  describe('Scenario: valid credentials (US-001)', () => {
    it('creates a session and audits a successful LOGIN with IP and user agent', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      await attempt(staff.email, staff.password).expect(200);

      expect(
        await prisma.session.count({ where: { userId: staff.userId } }),
      ).toBe(1);
      expect(lastAttempt()).toEqual({
        userId: staff.userId,
        outcome: 'SUCCESS',
        reason: null,
        ipAddress: expect.any(String),
        userAgent: 'rasi-e2e',
      });
    });
  });

  describe('Scenario: suspended staff member (US-001)', () => {
    it.each(['SUSPENDED', 'INACTIVE'] as const)(
      'a %s staff member with the correct password is refused, and no session is created',
      async (status) => {
        const staff = await createTestStaff(prisma, {
          organizationId,
          role: 'JUNIOR',
          status,
        });
        const response = await attempt(staff.email, staff.password).expect(403);

        expect(response.body).toMatchObject({
          code: 'STAFF_NOT_ACTIVE',
          message: STAFF_NOT_ACTIVE_MESSAGE,
        });
        expect(
          await prisma.session.count({ where: { userId: staff.userId } }),
        ).toBe(0);
        expect(lastAttempt()).toMatchObject({
          userId: staff.userId,
          outcome: 'REFUSED',
          reason: 'STAFF_NOT_ACTIVE',
        });
      },
    );

    it('the refusal is identical with a wrong password, so it does not reveal whether the password was correct', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'SENIOR',
        status: 'SUSPENDED',
      });
      const right = await attempt(staff.email, staff.password);
      const wrong = await attempt(staff.email, 'definitely-not-the-password');

      expect(wrong.status).toBe(right.status);
      expect(wrong.body).toEqual(right.body);
    });

    it('a soft-deleted staff member is refused', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      await prisma.staffProfile.update({
        where: { id: staff.staffProfileId },
        data: { deletedAt: new Date() },
      });
      await attempt(staff.email, staff.password).expect(403);
    });

    it('a user with no staff profile is refused', async () => {
      const user = await createTestStaff(prisma, {
        organizationId,
        role: null,
      });
      const response = await attempt(user.email, user.password).expect(403);
      expect(response.body.code).toBe('STAFF_NOT_ACTIVE');
    });
  });

  describe('failed sign-in', () => {
    it('a wrong password is 401 and audits a FAILURE against the user', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      const response = await attempt(staff.email, 'not-the-password').expect(
        401,
      );

      expect(response.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
      expect(lastAttempt()).toMatchObject({
        userId: staff.userId,
        outcome: 'FAILURE',
        reason: 'INVALID_EMAIL_OR_PASSWORD',
      });
    });

    it('an unknown email is 401, indistinguishable from a wrong password, and audited without the email', async () => {
      const email = testEmail('nobody');
      const response = await attempt(email, TEST_PASSWORD).expect(401);

      expect(response.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
      const recorded = lastAttempt();
      expect(recorded).toMatchObject({ userId: null, outcome: 'FAILURE' });
      const row = signInAuditRow(recorded!);
      expect(row.entityId).toBe(UNKNOWN_USER);
      expect(JSON.stringify(row)).not.toContain(email);
    });
  });

  describe('M01: no public sign-up', () => {
    it('refuses sign-up and creates no user', async () => {
      const email = testEmail('self-registered');
      await http()
        .post('/api/auth/sign-up/email')
        .send({ name: 'Walk In', email, password: TEST_PASSWORD })
        .expect(400);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });
  });

  describe('US-002: sign out invalidates the session server-side', () => {
    it('deletes the session row, and the old cookie is refused afterwards', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'ADMIN',
      });
      const cookie = await signIn(app, staff);
      await http().get('/api/sectors').set('Cookie', cookie).expect(200);

      await http().post('/api/auth/sign-out').set('Cookie', cookie).expect(200);

      expect(
        await prisma.session.count({ where: { userId: staff.userId } }),
      ).toBe(0);
      // A copy of the cookie kept on the device must not still work.
      const refused = await http()
        .get('/api/sectors')
        .set('Cookie', cookie)
        .expect(401);
      expect(refused.body.code).toBe('UNAUTHENTICATED');
    });

    it('signing out on one device leaves the staff member’s other devices signed in', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'ADMIN',
      });
      const phone = await signIn(app, staff);
      const office = await signIn(app, staff);

      await http().post('/api/auth/sign-out').set('Cookie', phone).expect(200);

      await http().get('/api/sectors').set('Cookie', phone).expect(401);
      await http().get('/api/sectors').set('Cookie', office).expect(200);
    });
  });

  describe('M13: a sign-in that cannot be audited does not happen', () => {
    it('revokes the new session and fails the request when the audit write fails', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      const working = signInAudit.write;
      signInAudit.write = async () => {
        throw new Error('audit_log unavailable');
      };
      try {
        const response = await attempt(staff.email, staff.password).expect(500);
        expect(response.body.code).toBe('SIGN_IN_AUDIT_FAILED');
      } finally {
        signInAudit.write = working;
      }
      expect(
        await prisma.session.count({ where: { userId: staff.userId } }),
      ).toBe(0);
    });
  });
});
