import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * M13 reads over HTTP (US-090, US-091). Read-only: who may call, validation,
 * and 404s. The rows themselves are proven in Tier 1
 * (`test/audit/audit-read.spec.ts`), because audit rows cannot be deleted and
 * this tier records audit entries in memory.
 */
describe('audit log and account history (M13, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  const cookies = {} as Record<StaffRole, string>;

  const as = (role: StaffRole) => (path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookies[role]);

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A']);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      const staff = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role,
      });
      cookies[role] = await signIn(app, staff);
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('the audit log is for Admins and Super Admins; Seniors and Juniors get 403', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const page = await as(role)('/api/audit-log').expect(200);
      expect(page.body).toMatchObject({
        data: expect.any(Array),
        hasMore: expect.any(Boolean),
      });
    }
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      await as(role)('/api/audit-log').expect(403);
    }
    await request(app.getHttpServer()).get('/api/audit-log').expect(401);
  });

  it('filters are validated, and a reversed date range is refused', async () => {
    const invalid = await as('ADMIN')(
      '/api/audit-log?action=ERASE&entityTable=secrets&from=5-1-2026',
    ).expect(400);
    expect(
      invalid.body.details.map((d: { field: string }) => d.field).sort(),
    ).toEqual(['action', 'entityTable', 'from']);

    const reversed = await as('ADMIN')(
      '/api/audit-log?from=2026-01-06&to=2026-01-05',
    ).expect(400);
    expect(reversed.body.code).toBe('INVALID_DATE_RANGE');

    await as('ADMIN')('/api/audit-log?cursor=not-a-cursor').expect(400);
    await as('ADMIN')(
      '/api/audit-log?from=2026-01-05&to=2026-01-05&action=LOGIN&entityTable=user',
    ).expect(200);
  });

  it('account history is for Admins and Super Admins, and a missing account is 404', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      await as(role)('/api/accounts/acc_missing/history').expect(404);
    }
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      await as(role)('/api/accounts/acc_missing/history').expect(403);
    }
  });
});
