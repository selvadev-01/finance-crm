import type { INestApplication } from '@nestjs/common';
import { openLinePeriod } from './database.js';
import type { PrismaClient, StaffRole } from '@repo/db';
import { addCalendarDays, toBusinessDate, toUtcMidnight } from '@repo/domain';
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
 * M05 over HTTP (US-030, US-032): preview, creating PENDING accounts, reads,
 * scope and money visibility, and the refusals.
 *
 * **Never disburses successfully.** Disbursement writes ledger rows, which
 * reject DELETE, into the shared schema; it is proven in Tier 1
 * (`test/accounts/account.service.spec.ts`). Only refusals that write nothing
 * are exercised here.
 */
describe('accounts (M05, US-030, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  let lineA: string;
  let customerOnA: string;
  let customerOnB: string;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  const today = toBusinessDate(new Date());

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body?: object) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
  });

  const terms = (overrides: object = {}) => ({
    customerId: customerOnA,
    accountAmount: '10,000',
    investedAmount: '8500',
    dailyAmount: '100',
    termDays: 100,
    disbursementDate: today,
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
    const customer = (lineId: string, name: string) =>
      prisma.customer.create({
        data: {
          organizationId,
          customerCode: testCode('CUS'),
          name,
          mobile: '+919800000009',
          address: 'Market Road',
          sectorId: org.sector.id,
          lineId,
          references: { create: [{ name: 'Ref', mobile: '+919800000010' }] },
          linePeriods: openLinePeriod(lineId),
        },
      });
    customerOnA = (await customer(lineA, 'On A')).id;
    customerOnB = (await customer(lineB, 'On B')).id;
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('previews the derived values and the full schedule without saving anything', async () => {
    const before = await prisma.accountLoan.count({
      where: { organizationId },
    });
    const response = await as('ADMIN')
      .post('/api/accounts/preview', terms())
      .expect(200);
    expect(response.body).toMatchObject({
      profitAmount: '1500.00',
      slotCount: 100,
    });
    expect(response.body.slots).toHaveLength(100);
    expect(await prisma.accountLoan.count({ where: { organizationId } })).toBe(
      before,
    );
  });

  it('refuses invalid terms with the reasons US-030 names, at the field', async () => {
    const invested = await as('ADMIN')
      .post('/api/accounts/preview', terms({ investedAmount: '10500' }))
      .expect(400);
    expect(invested.body.details).toEqual([
      {
        field: 'investedAmount',
        issue: expect.stringContaining('profit cannot be zero or negative'),
      },
    ]);

    const term = await as('ADMIN')
      .post('/api/accounts', terms({ dailyAmount: '50' }))
      .expect(400);
    expect(term.body.details).toEqual([
      { field: 'termDays', issue: '50 × 100 days cannot clear 10,000' },
    ]);
  });

  it('creates a PENDING account with its schedule, audited, and lists it for the customer', async () => {
    const created = await as('ADMIN')
      .post('/api/accounts', terms())
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      customerId: customerOnA,
      lineId: lineA,
      accountAmount: '10000.00',
      profitAmount: '1500.00',
      outstandingAmount: '10000.00',
    });
    expect(
      recordedAudit.find((row) => row.entityId === created.body.id),
    ).toMatchObject({
      entityTable: 'account_loan',
      action: 'CREATE',
    });

    const schedule = await as('ADMIN')
      .get(`/api/accounts/${created.body.id}/schedule`)
      .expect(200);
    expect(schedule.body.slots).toHaveLength(100);
    expect(schedule.body.slots[0]).toMatchObject({
      sequence: 1,
      status: 'PENDING',
      expectedAmount: '100.00',
    });

    const listed = await as('ADMIN')
      .get(`/api/accounts?customerId=${customerOnA}&limit=200`)
      .expect(200);
    expect(listed.body.data.map((a: { id: string }) => a.id)).toContain(
      created.body.id,
    );
  });

  it('US-030a over HTTP: a past date previews as mid-term with the amount entered, and without it is refused before any write', async () => {
    const past = addCalendarDays(today, -30);
    const preview = await as('ADMIN')
      .post(
        '/api/accounts/preview',
        terms({ disbursementDate: past, collectedToDate: '2,000' }),
      )
      .expect(200);
    expect(preview.body).toMatchObject({
      kind: 'MID_TERM',
      collectedAmount: '2000.00',
      outstandingAmount: '8000.00',
    });
    expect(preview.body.slots[0]).toMatchObject({ status: 'COLLECTED' });

    // Creating a mid-term account posts to the ledger, so it is proven in
    // Tier 1; here only the refusal, which writes nothing.
    const refused = await as('ADMIN')
      .post('/api/accounts', terms({ disbursementDate: past }))
      .expect(422);
    expect(refused.body.code).toBe('COLLECTED_TO_DATE_REQUIRED');

    const tooMuch = await as('ADMIN')
      .post(
        '/api/accounts/preview',
        terms({ disbursementDate: past, collectedToDate: '10000' }),
      )
      .expect(400);
    expect(tooMuch.body.details).toEqual([
      expect.objectContaining({ field: 'collectedToDate' }),
    ]);
  });

  it('a Senior or Junior cannot preview, create or disburse', async () => {
    const created = await as('ADMIN')
      .post('/api/accounts', terms())
      .expect(201);
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      await as(role).post('/api/accounts/preview', terms()).expect(403);
      await as(role).post('/api/accounts', terms()).expect(403);
      await as(role)
        .post(`/api/accounts/${created.body.id}/disbursement`)
        .expect(403);
    }
  });

  it('the Junior on the line sees the account without invested amount or profit; the Senior sees both', async () => {
    const created = await as('ADMIN')
      .post('/api/accounts', terms())
      .expect(201);
    const junior = await as('JUNIOR')
      .get(`/api/accounts/${created.body.id}`)
      .expect(200);
    expect(junior.body).toMatchObject({
      outstandingAmount: '10000.00',
      investedAmount: null,
      profitAmount: null,
    });
    const senior = await as('SENIOR')
      .get(`/api/accounts/${created.body.id}`)
      .expect(200);
    expect(senior.body).toMatchObject({
      investedAmount: '8500.00',
      profitAmount: '1500.00',
    });
  });

  it('an account on another line is 404 to its Senior and Junior, identical to a missing one', async () => {
    const onB = await as('ADMIN')
      .post('/api/accounts', terms({ customerId: customerOnB }))
      .expect(201);
    for (const role of ['SENIOR', 'JUNIOR'] as const) {
      const hidden = await as(role)
        .get(`/api/accounts/${onB.body.id}`)
        .expect(404);
      const missing = await as(role)
        .get('/api/accounts/does-not-exist')
        .expect(404);
      expect(hidden.body).toMatchObject({
        code: missing.body.code,
        message: missing.body.message,
      });
      await as(role).get(`/api/accounts/${onB.body.id}/schedule`).expect(404);
    }
  });

  it('disbursing an account planned for a later day is refused and writes nothing', async () => {
    const later = await as('ADMIN')
      .post(
        '/api/accounts',
        terms({ disbursementDate: addCalendarDays(today, 7) }),
      )
      .expect(201);
    const refused = await as('ADMIN')
      .post(`/api/accounts/${later.body.id}/disbursement`)
      .expect(422);
    expect(refused.body.code).toBe('DISBURSEMENT_DATE_IN_FUTURE');
    expect(
      await prisma.ledgerAccount.count({ where: { organizationId } }),
    ).toBe(0);
    await as('ADMIN')
      .get(`/api/accounts/${later.body.id}`)
      .expect(200)
      .then((response) => expect(response.body.status).toBe('PENDING'));
  });

  /**
   * US-035 over HTTP. Only the DEFAULTED path is exercised here: a write-off
   * posts to the ledger, which Tier 2 may never write, and is proven in Tier 1
   * (`test/accounts/account.service.spec.ts`).
   */
  describe('closing an account (US-035)', () => {
    /** An ACTIVE account with no ledger rows, so cleanup can remove it. */
    const activeAccount = async () =>
      prisma.accountLoan.create({
        data: {
          organizationId,
          accountCode: testCode('ACC'),
          customerId: customerOnA,
          lineId: lineA,
          accountAmount: '10000',
          investedAmount: '8500',
          profitAmount: '1500',
          dailyAmount: '100',
          termDays: 100,
          outstandingAmount: '10000',
          status: 'ACTIVE',
          // BR-03: the first collection comes after disbursement.
          disbursementDate: toUtcMidnight(addCalendarDays(today, -1)),
          firstCollectionDate: toUtcMidnight(today),
          targetCompletionDate: toUtcMidnight(today),
          schedules: {
            create: [
              {
                sequence: 1,
                dueDate: toUtcMidnight(today),
                expectedAmount: '100',
                status: 'PENDING',
              },
            ],
          },
        },
      });

    it('a Super Admin defaults an account: collection stops, the reason is kept, and nothing is posted', async () => {
      const account = await activeAccount();

      const response = await as('SUPER_ADMIN')
        .post(`/api/accounts/${account.id}/closure`, {
          status: 'DEFAULTED',
          note: 'Refusing to pay; with the Senior since March',
        })
        .expect(200);
      expect(response.body).toMatchObject({
        id: account.id,
        status: 'DEFAULTED',
      });

      const row = await prisma.accountLoan.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(row.closureNote).toContain('Refusing to pay');
      expect(
        await prisma.accountSchedule.count({
          where: { accountLoanId: account.id, status: 'PENDING' },
        }),
      ).toBe(0);
      // DEFAULTED leaves the money owed, so the ledger is untouched.
      expect(
        await prisma.ledgerTransaction.count({
          where: { sourceId: account.id },
        }),
      ).toBe(0);
    });

    it('the reason is mandatory, and a pending account cannot be closed', async () => {
      const account = await activeAccount();
      const missing = await as('SUPER_ADMIN')
        .post(`/api/accounts/${account.id}/closure`, {
          status: 'DEFAULTED',
          note: '  ',
        })
        .expect(400);
      expect(missing.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'note' })]),
      );

      const pending = await as('ADMIN')
        .post('/api/accounts', terms())
        .expect(201);
      const refused = await as('SUPER_ADMIN')
        .post(`/api/accounts/${pending.body.id}/closure`, {
          status: 'DEFAULTED',
          note: 'Never disbursed',
        })
        .expect(422);
      expect(refused.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('an Admin, Senior or Junior cannot close an account', async () => {
      const account = await activeAccount();
      for (const role of ['ADMIN', 'SENIOR', 'JUNIOR'] as const) {
        const response = await as(role)
          .post(`/api/accounts/${account.id}/closure`, {
            status: 'DEFAULTED',
            note: 'Not mine to close',
          })
          .expect(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      }
      expect(
        (
          await prisma.accountLoan.findUniqueOrThrow({
            where: { id: account.id },
          })
        ).status,
      ).toBe('ACTIVE');
    });
  });
});
