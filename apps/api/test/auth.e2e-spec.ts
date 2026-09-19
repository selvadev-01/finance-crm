import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@repo/db';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';

import {
  SESSION_ABSOLUTE_LIMIT_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
} from '../src/auth/session-policy.js';
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

const SESSION_COOKIE = 'better-auth.session_token=';

function setCookies(response: Response): string[] {
  const header = response.headers['set-cookie'] as unknown;
  if (Array.isArray(header)) return header.map(String);
  return typeof header === 'string' ? [header] : [];
}

/** The `Set-Cookie` line for the session token, if the response sent one. */
function sessionCookie(response: Response): string | undefined {
  return setCookies(response).find((line) => line.startsWith(SESSION_COOKIE));
}

/** Every cookie the response set, as a request `Cookie` header. */
function cookieHeader(response: Response): string {
  return setCookies(response)
    .map((line) => line.split(';')[0])
    .join('; ');
}

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
    it('signs an ACTIVE staff member in with an HttpOnly session cookie', async () => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'JUNIOR',
      });
      const response = await attempt(staff.email, staff.password).expect(200);

      const cookie = sessionCookie(response);
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
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

  describe('session lifetime (authentication.md#session-duration)', () => {
    const SEVEN_DAYS_MS = SESSION_EXPIRES_IN_SECONDS * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MINUTE_MS = 60 * 1000;

    const signInWith = async (rememberMe?: boolean) => {
      const staff = await createTestStaff(prisma, {
        organizationId,
        role: 'ADMIN',
      });
      const response = await http()
        .post('/api/auth/sign-in/email')
        .send({ email: staff.email, password: staff.password, rememberMe })
        .expect(200);
      return { staff, response, cookie: cookieHeader(response) };
    };
    const sessionOf = (userId: string) =>
      prisma.session.findFirstOrThrow({ where: { userId } });
    const setSession = (userId: string, data: Prisma.SessionUpdateInput) =>
      prisma.session.updateMany({ where: { userId }, data });
    const msFromNow = (date: Date) => date.getTime() - Date.now();

    it('"Keep me signed in" (the default) gives a 7-day cookie and session', async () => {
      const { staff, response } = await signInWith();

      expect(sessionCookie(response)).toContain(
        `Max-Age=${SESSION_EXPIRES_IN_SECONDS}`,
      );
      const { expiresAt } = await sessionOf(staff.userId);
      expect(msFromNow(expiresAt)).toBeGreaterThan(SEVEN_DAYS_MS - MINUTE_MS);
      expect(msFromNow(expiresAt)).toBeLessThanOrEqual(SEVEN_DAYS_MS);
    });

    it('without it, the cookie ends with the browser and the session after 1 day', async () => {
      const { staff, response } = await signInWith(false);

      const cookie = sessionCookie(response);
      expect(cookie).toBeDefined();
      expect(cookie).not.toContain('Max-Age');
      expect(cookie).not.toContain('Expires');
      const { expiresAt } = await sessionOf(staff.userId);
      expect(msFromNow(expiresAt)).toBeGreaterThan(DAY_MS - MINUTE_MS);
      expect(msFromNow(expiresAt)).toBeLessThanOrEqual(DAY_MS);
    });

    it('renews a day-old session on a Rasi request and sends the browser a fresh 7-day cookie', async () => {
      const { staff, cookie } = await signInWith();
      // As if signed in two days ago: past `updateAge`, so due for renewal.
      await setSession(staff.userId, {
        expiresAt: new Date(Date.now() + 5 * DAY_MS),
      });

      const response = await http()
        .get('/api/sectors')
        .set('Cookie', cookie)
        .expect(200);

      expect(sessionCookie(response)).toContain(
        `Max-Age=${SESSION_EXPIRES_IN_SECONDS}`,
      );
      const { expiresAt } = await sessionOf(staff.userId);
      expect(msFromNow(expiresAt)).toBeGreaterThan(SEVEN_DAYS_MS - MINUTE_MS);
    });

    it('does not reissue the cookie on a request when the session was renewed within a day', async () => {
      const { cookie } = await signInWith();

      const response = await http()
        .get('/api/sectors')
        .set('Cookie', cookie)
        .expect(200);

      expect(sessionCookie(response)).toBeUndefined();
    });

    it('never renews a session signed in without "Keep me signed in"', async () => {
      const { staff, cookie } = await signInWith(false);
      const soon = new Date(Date.now() + 60 * MINUTE_MS);
      await setSession(staff.userId, { expiresAt: soon });

      await http().get('/api/sectors').set('Cookie', cookie).expect(200);

      const { expiresAt } = await sessionOf(staff.userId);
      expect(expiresAt.getTime()).toBe(soon.getTime());
    });

    it('keeps a session in use 29 days after sign-in', async () => {
      const { staff, cookie } = await signInWith();
      await setSession(staff.userId, {
        createdAt: new Date(Date.now() - 29 * DAY_MS),
      });

      await http().get('/api/sectors').set('Cookie', cookie).expect(200);
    });

    it('ends a session 30 days after sign-in however recently it was renewed, and expires the cookie', async () => {
      const { staff, cookie } = await signInWith();
      await setSession(staff.userId, {
        createdAt: new Date(
          Date.now() - SESSION_ABSOLUTE_LIMIT_SECONDS * 1000 - MINUTE_MS,
        ),
      });

      const refused = await http()
        .get('/api/sectors')
        .set('Cookie', cookie)
        .expect(401);

      expect(refused.body.code).toBe('UNAUTHENTICATED');
      expect(sessionCookie(refused)).toContain('Max-Age=0');
      expect(
        await prisma.session.count({ where: { userId: staff.userId } }),
      ).toBe(0);
    });

    it('get-session answers a session past the absolute limit as signed out', async () => {
      const { staff, cookie } = await signInWith();
      await setSession(staff.userId, {
        createdAt: new Date(
          Date.now() - SESSION_ABSOLUTE_LIMIT_SECONDS * 1000 - MINUTE_MS,
        ),
      });

      const response = await http()
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toBeNull();
      expect(
        await prisma.session.count({ where: { userId: staff.userId } }),
      ).toBe(0);
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
