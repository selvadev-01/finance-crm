import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { addCalendarDays, toBusinessDate } from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * US-032 capital over HTTP: who may add and read it, and the refusals' real
 * statuses. **Nothing is ever recorded here** — `capital_entry` and the
 * ledger are append-only, so every request below is refused before its
 * transaction opens or only reads; recording is proven in Tier 1
 * (`test/cash/capital.service.spec.ts`).
 */
describe('capital (US-032, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  const cookies = {} as Record<StaffRole, string>;
  const tomorrow = addCalendarDays(toBusinessDate(new Date()), 1);

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A']);
    organizationId = org.organization.id;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      const staff = await createTestStaff(prisma, { organizationId, role });
      if (role === 'SENIOR' || role === 'JUNIOR') {
        await prisma.lineAssignment.create({
          data: {
            staffProfileId: staff.staffProfileId,
            lineId: org.lines[0]!.id,
            assignmentRole: role,
            effectiveFrom: new Date('2026-01-01'),
          },
        });
      }
      cookies[role] = await signIn(app, staff);
    }
  });

  afterAll(async () => {
    await app.close();
    expect(await prisma.capitalEntry.count({ where: { organizationId } })).toBe(
      0,
    );
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('an Admin reads capital — none yet, and office cash at zero — but may not add it', async () => {
    const list = await as('ADMIN').get('/api/capital');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      data: [],
      total: 0,
      totalCapital: '0.00',
      officeCash: '0.00',
    });

    const add = await as('ADMIN').post('/api/capital', {
      amount: '1000',
      note: 'Not theirs to record',
    });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe('PERMISSION_DENIED');
  });

  it('a Senior and a Junior may not read it', async () => {
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const response = await as(role).get('/api/capital');
      expect(response.status).toBe(403);
    }
  });

  it('the Super Admin is refused a future date at the field, and a zero amount or blank note as input', async () => {
    const future = await as('SUPER_ADMIN').post('/api/capital', {
      amount: '1000',
      businessDate: tomorrow,
      note: 'Promised, not arrived',
    });
    expect(future.status).toBe(422);
    expect(future.body).toMatchObject({
      code: 'CAPITAL_DATE_IN_FUTURE',
      details: [{ field: 'businessDate', issue: 'is in the future' }],
    });

    const zero = await as('SUPER_ADMIN').post('/api/capital', {
      amount: '0',
      note: 'Nothing',
    });
    expect(zero.status).toBe(400);

    const blank = await as('SUPER_ADMIN').post('/api/capital', {
      amount: '1000',
      note: '   ',
    });
    expect(blank.status).toBe(400);
  });
});
