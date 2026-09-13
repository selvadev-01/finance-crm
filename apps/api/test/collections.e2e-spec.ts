import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { toBusinessDate, toUtcMidnight } from '@repo/domain';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
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
 * M07 over HTTP (US-040, US-041). **Never records a collection**: collection
 * and ledger rows reject DELETE, so every successful write — and replay — is
 * proven in Tier 1 (`test/collections/collection.service.spec.ts`), and the
 * replay status in `test/platform/contract-replay.e2e-spec.ts`. Here: who may
 * call, validation, the refusals that write nothing, and the route.
 */
describe('collections (M07, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let lineA: string;
  let activeOnA: string;
  let pendingOnA: string;
  let activeOnB: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  const today = toBusinessDate(new Date());

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
  });
  const collection = (accountLoanId: string, overrides: object = {}) => ({
    idempotencyKey: randomUUID(),
    accountLoanId,
    amount: '100',
    capturedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A', 'Line B']);
    organizationId = org.organization.id;
    lineA = org.lines[0]!.id;
    const lineB = org.lines[1]!.id;
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, { organizationId, role });
      cookies[role] = await signIn(app, staff[role]);
    }
    await prisma.lineAssignment.create({
      data: {
        staffProfileId: staff.JUNIOR.staffProfileId,
        lineId: lineA,
        assignmentRole: 'JUNIOR',
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    // Accounts inserted directly, with a slot due today and no ledger rows,
    // so they can be removed again. A PENDING account is cleaned up by
    // deleteTestRunData; the ACTIVE ones are removed by id in afterAll.
    const account = async (
      lineId: string,
      status: 'ACTIVE' | 'PENDING',
      name: string,
    ) => {
      const customer = await prisma.customer.create({
        data: {
          organizationId,
          customerCode: testCode('CUS'),
          name,
          mobile: '+919800000011',
          address: 'Market Road',
          sectorId: org.sector.id,
          lineId,
        },
      });
      const created = await prisma.accountLoan.create({
        data: {
          organizationId,
          accountCode: testCode('ACC'),
          customerId: customer.id,
          lineId,
          accountAmount: '1000',
          investedAmount: '900',
          profitAmount: '100',
          dailyAmount: '100',
          termDays: 10,
          outstandingAmount: '1000',
          status,
          disbursementDate: new Date('2026-01-03'),
          firstCollectionDate: new Date('2026-01-05'),
          targetCompletionDate: toUtcMidnight(today),
          schedules: {
            create: [
              {
                sequence: 1,
                dueDate: toUtcMidnight(today),
                expectedAmount: '100',
              },
            ],
          },
        },
      });
      return created.id;
    };
    activeOnA = await account(lineA, 'ACTIVE', 'Active on A');
    pendingOnA = await account(lineA, 'PENDING', 'Pending on A');
    activeOnB = await account(lineB, 'ACTIVE', 'Active on B');
  });

  afterAll(async () => {
    await app.close();
    await prisma.accountLoan.deleteMany({
      where: { id: { in: [activeOnA, activeOnB] } },
    });
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('only a Junior records: every other role is 403 before anything is read', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
      const response = await as(role)
        .post('/api/collections', collection(activeOnA))
        .expect(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    }
  });

  it('validates the idempotency key, the amount and the capture time at the field', async () => {
    const response = await as('JUNIOR')
      .post(
        '/api/collections',
        collection(activeOnA, {
          idempotencyKey: 'not-a-uuid',
          amount: '-5',
          capturedAt: 'yesterday',
        }),
      )
      .expect(400);
    expect(
      response.body.details.map((d: { field: string }) => d.field).sort(),
    ).toEqual(['amount', 'capturedAt', 'idempotencyKey']);
  });

  it('refuses a pending account (422) and an account off the Junior’s line (404), writing nothing', async () => {
    const pending = await as('JUNIOR')
      .post('/api/collections', collection(pendingOnA))
      .expect(422);
    expect(pending.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    const offLine = await as('JUNIOR')
      .post('/api/collections', collection(activeOnB))
      .expect(404);
    expect(offLine.body.code).toBe('ACCOUNT_NOT_FOUND');
    expect(
      await prisma.collection.count({
        where: { accountLoanId: { in: [activeOnA, pendingOnA, activeOnB] } },
      }),
    ).toBe(0);
  });

  it('refuses an amount above the outstanding, stating it (US-041)', async () => {
    const response = await as('JUNIOR')
      .post('/api/collections', collection(activeOnA, { amount: '2000' }))
      .expect(422);
    expect(response.body).toMatchObject({
      code: 'AMOUNT_EXCEEDS_OUTSTANDING',
      message: expect.stringContaining('₹1000.00'),
    });
  });

  it('US-040: the Junior’s route lists only their line’s accounts due today, without invested amount or profit', async () => {
    const response = await as('JUNIOR').get('/api/route').expect(200);
    expect(response.body).toMatchObject({ businessDate: today, lineId: lineA });
    if (response.body.day.kind === 'WORKING') {
      const accounts = response.body.customers.flatMap(
        (c: { accounts: { accountLoanId: string }[] }) => c.accounts,
      );
      expect(
        accounts.map((a: { accountLoanId: string }) => a.accountLoanId),
      ).toEqual([activeOnA]);
      expect(accounts[0]).toMatchObject({
        expectedAmount: '100.00',
        outstandingAmount: '1000.00',
        collectedToday: null,
      });
    } else {
      expect(response.body.customers).toEqual([]);
    }
    expect(JSON.stringify(response.body)).not.toMatch(/invested|profit/i);

    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR'] as const) {
      await as(role).get('/api/route').expect(403);
    }
  });
});
