import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import {
  createTestApp,
  recordedAudit,
  recordedPasswordChanges,
} from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  TEST_PASSWORD,
} from './staff.js';

/**
 * US-003 over HTTP: an Admin resets a field staff member's password, and the
 * staff member is walked through the forced change.
 */
describe('admin password reset (US-003, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let adminCookie: string;

  const http = () => request(app.getHttpServer());
  const reset = (staffProfileId: string, cookie = adminCookie) =>
    http()
      .post(`/api/staff/${staffProfileId}/password-reset`)
      .set('Cookie', cookie);

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    organizationId = (await createTestOrganization(prisma)).organization.id;
    const admin = await createTestStaff(prisma, {
      organizationId,
      role: 'ADMIN',
    });
    adminCookie = await signIn(app, admin);
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('walks a Junior from reset to a working new password', async () => {
    const junior = await createTestStaff(prisma, {
      organizationId,
      role: 'JUNIOR',
    });
    const lostPhone = await signIn(app, junior);

    // 1. The Admin resets. The Junior's lost phone stops working at once.
    const response = await reset(junior.staffProfileId).expect(201);
    expect(response.body).toEqual({
      temporaryPassword: expect.stringMatching(/^[A-Z2-9]{12}$/),
      sessionsRevoked: 1,
    });
    const temporaryPassword = response.body.temporaryPassword as string;
    await http().get('/api/lines').set('Cookie', lostPhone).expect(401);

    // 2. The old password no longer signs in; the temporary one does.
    await http()
      .post('/api/auth/sign-in/email')
      .send({ email: junior.email, password: TEST_PASSWORD })
      .expect(401);
    const temporaryCookie = await signIn(app, {
      email: junior.email,
      password: temporaryPassword,
    });

    // 3. Until the password is changed, every Rasi route refuses.
    const blocked = await http()
      .get('/api/lines')
      .set('Cookie', temporaryCookie)
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // 4. The change itself is allowed, and lifts the block.
    await http()
      .post('/api/auth/change-password')
      .set('Cookie', temporaryCookie)
      .send({
        currentPassword: temporaryPassword,
        newPassword: 'a-brand-new-long-password',
      })
      .expect(200);
    expect(recordedPasswordChanges).toContain(junior.userId);
    await http().get('/api/lines').set('Cookie', temporaryCookie).expect(200);

    // 5. The temporary password is spent.
    await http()
      .post('/api/auth/sign-in/email')
      .send({ email: junior.email, password: temporaryPassword })
      .expect(401);
  });

  it('audits the reset, and the temporary password is nowhere in the audit entry', async () => {
    const senior = await createTestStaff(prisma, {
      organizationId,
      role: 'SENIOR',
    });
    const response = await reset(senior.staffProfileId).expect(201);

    const entry = recordedAudit.at(-1);
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityTable: 'staff_profile',
      entityId: senior.staffProfileId,
    });
    expect(JSON.stringify(entry)).not.toContain(
      response.body.temporaryPassword,
    );
  });

  it('GET /api/me describes the signed-in staff member, and reports a pending forced change', async () => {
    const junior = await createTestStaff(prisma, {
      organizationId,
      role: 'JUNIOR',
    });
    const cookie = await signIn(app, junior);
    const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
    expect(me.body).toEqual({
      userId: junior.userId,
      staffProfileId: junior.staffProfileId,
      name: 'Test Staff',
      email: junior.email,
      role: 'JUNIOR',
      currentLineId: null,
    });

    const { temporaryPassword } = (
      await reset(junior.staffProfileId).expect(201)
    ).body as { temporaryPassword: string };
    const afterReset = await signIn(app, {
      email: junior.email,
      password: temporaryPassword,
    });
    const blocked = await http()
      .get('/api/me')
      .set('Cookie', afterReset)
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('an Admin cannot reset a Super Admin', async () => {
    const owner = await createTestStaff(prisma, {
      organizationId,
      role: 'SUPER_ADMIN',
    });
    const response = await reset(owner.staffProfileId).expect(403);
    expect(response.body.code).toBe('CANNOT_RESET_SUPER_ADMIN');
  });

  it('staff in another organization are 404', async () => {
    const elsewhere = await createTestOrganization(prisma);
    const theirs = await createTestStaff(prisma, {
      organizationId: elsewhere.organization.id,
      role: 'JUNIOR',
    });
    const response = await reset(theirs.staffProfileId).expect(404);
    expect(response.body.code).toBe('STAFF_NOT_FOUND');
  });

  it('a Senior cannot reset anyone', async () => {
    const senior = await createTestStaff(prisma, {
      organizationId,
      role: 'SENIOR',
    });
    const junior = await createTestStaff(prisma, {
      organizationId,
      role: 'JUNIOR',
    });
    const response = await reset(
      junior.staffProfileId,
      await signIn(app, senior),
    ).expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });
});
