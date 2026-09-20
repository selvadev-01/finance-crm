import {
  Controller,
  Get,
  type INestApplication,
  Injectable,
  Param,
} from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import { CurrentContext, RequirePermission } from '../src/access/decorators.js';
import { customerScope, foundInScope, inScope } from '../src/access/scope.js';
import type { RequestContext } from '../src/platform/context/request-context.js';
import { Database } from '../src/platform/database/database.js';
import { captureLogs, createTestApp } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testCode,
} from './database.js';
import { openLinePeriod } from './database.js';
import { createTestStaff, signIn } from './staff.js';

/** Rows created once for the file, read by the probe controller and the tests. */
const rows = {
  line3: '',
  line7: '',
  customerOn3: '',
  customerOn7: '',
};

/**
 * A repository shaped the way M04's will be: every method takes the context,
 * and applies the scope through `inScope` / `foundInScope`.
 */
@Injectable()
class ProbeCustomerRepository {
  constructor(private readonly database: Database) {}

  async getById(context: RequestContext, id: string) {
    const customer = await this.database.client.customer.findFirst({
      where: inScope(customerScope(context), { id }),
      select: { id: true },
    });
    return foundInScope(customer, 'customer');
  }

  list(context: RequestContext) {
    return this.database.client.customer.findMany({
      // Limited to this file's lines so development data never appears.
      where: inScope(customerScope(context), {
        lineId: { in: [rows.line3, rows.line7] },
      }),
      select: { id: true },
    });
  }
}

/** Stand-ins for the M04 customer, M11 dashboard and M07 endpoints US-004 names. */
@Controller('__access')
class AccessProbeController {
  constructor(private readonly customers: ProbeCustomerRepository) {}

  @RequirePermission('customer.view')
  @Get('customers/:id')
  getCustomer(
    @CurrentContext() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.customers.getById(context, id);
  }

  @RequirePermission('customer.view')
  @Get('customers')
  listCustomers(@CurrentContext() context: RequestContext) {
    return this.customers.list(context);
  }

  @RequirePermission('money.businessTotals')
  @Get('dashboard/business')
  businessDashboard() {
    return { total: '0.00' };
  }

  @RequirePermission('collection.record')
  @Get('context')
  context(@CurrentContext() context: RequestContext) {
    return context;
  }
}

describe('server-side scope enforcement (US-004, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let organizationId: string;
  const logs = captureLogs();

  const http = () => request(app.getHttpServer());

  interface Staff {
    cookie: string;
    userId: string;
    staffProfileId: string;
  }

  /** An ACTIVE staff member with a real Better Auth session. */
  async function signUp(role: StaffRole): Promise<Staff> {
    const staff = await createTestStaff(prisma, { organizationId, role });
    const cookie = await signIn(app, staff);
    return {
      cookie,
      userId: staff.userId,
      staffProfileId: staff.staffProfileId,
    };
  }

  const assign = (staff: Staff, lineId: string, role: 'SENIOR' | 'JUNIOR') =>
    prisma.lineAssignment.create({
      data: {
        staffProfileId: staff.staffProfileId,
        lineId,
        assignmentRole: role,
        effectiveFrom: new Date('2026-09-01'),
      },
    });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp({
      controllers: [AccessProbeController],
      providers: [ProbeCustomerRepository],
      logDestination: logs,
      config: { LOG_LEVEL: 'info' },
    });

    const organization = await prisma.organization.create({
      data: {
        name: testCode('ORG'),
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      },
    });
    organizationId = organization.id;
    const sector = await prisma.sector.create({
      data: { organizationId, code: testCode('SEC'), name: 'Sector' },
    });
    const line = (name: string) =>
      prisma.line.create({
        data: {
          organizationId,
          sectorId: sector.id,
          code: testCode('LN'),
          name,
        },
      });
    const customer = (lineId: string) =>
      prisma.customer.create({
        data: {
          organizationId,
          sectorId: sector.id,
          lineId,
          customerCode: testCode('CUS'),
          name: 'Customer',
          mobile: '+919800000000',
          address: 'Address',
          linePeriods: openLinePeriod(lineId),
        },
      });

    rows.line3 = (await line('Line 3')).id;
    rows.line7 = (await line('Line 7')).id;
    rows.customerOn3 = (await customer(rows.line3)).id;
    rows.customerOn7 = (await customer(rows.line7)).id;
  });

  // A line has one current Senior (line_assignment_current_senior_key), so each
  // test starts with no assignments from earlier tests in this run.
  afterEach(async () => {
    await prisma.lineAssignment.deleteMany({
      where: { lineId: { in: [rows.line3, rows.line7] } },
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  describe('Scenario: Junior requests another line’s customer', () => {
    it('answers 404, identical to a customer that does not exist', async () => {
      const junior = await signUp('JUNIOR');
      await assign(junior, rows.line3, 'JUNIOR');

      const otherLine = await http()
        .get(`/__access/customers/${rows.customerOn7}`)
        .set('Cookie', junior.cookie)
        .expect(404);
      const nonexistent = await http()
        .get('/__access/customers/does-not-exist')
        .set('Cookie', junior.cookie)
        .expect(404);

      const withoutId = ({
        correlationId: _id,
        ...body
      }: Record<string, unknown>) => body;
      expect(withoutId(otherLine.body)).toEqual(withoutId(nonexistent.body));
      expect(otherLine.body.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('answers 200 for a customer on their own line', async () => {
      const junior = await signUp('JUNIOR');
      await assign(junior, rows.line3, 'JUNIOR');

      await http()
        .get(`/__access/customers/${rows.customerOn3}`)
        .set('Cookie', junior.cookie)
        .expect(200, { id: rows.customerOn3 });
    });
  });

  describe('Scenario: Senior requests a business-wide total', () => {
    it('a Senior receives 403', async () => {
      const senior = await signUp('SENIOR');
      await assign(senior, rows.line3, 'SENIOR');

      const response = await http()
        .get('/__access/dashboard/business')
        .set('Cookie', senior.cookie)
        .expect(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    });

    it.each(['ADMIN', 'SUPER_ADMIN'] as const)(
      'an %s receives 200 with no assignment',
      async (role) => {
        const admin = await signUp(role);
        await http()
          .get('/__access/dashboard/business')
          .set('Cookie', admin.cookie)
          .expect(200);
      },
    );
  });

  describe('Scenario: scope follows reassignment', () => {
    it('a Senior moved from Line 3 to Line 7 sees Line 7 on the very next request, and loses Line 3', async () => {
      const senior = await signUp('SENIOR');
      const onThree = await assign(senior, rows.line3, 'SENIOR');

      await http()
        .get('/__access/customers')
        .set('Cookie', senior.cookie)
        .expect(200, [{ id: rows.customerOn3 }]);

      // The move, as M03 will perform it: end the current row, open a new one.
      await prisma.lineAssignment.update({
        where: { id: onThree.id },
        data: { effectiveTo: new Date('2026-09-12') },
      });
      await prisma.lineAssignment.create({
        data: {
          staffProfileId: senior.staffProfileId,
          lineId: rows.line7,
          assignmentRole: 'SENIOR',
          effectiveFrom: new Date('2026-09-12'),
        },
      });

      // Same session, no sign-in again: nothing about the old line is cached.
      await http()
        .get('/__access/customers')
        .set('Cookie', senior.cookie)
        .expect(200, [{ id: rows.customerOn7 }]);
      await http()
        .get(`/__access/customers/${rows.customerOn3}`)
        .set('Cookie', senior.cookie)
        .expect(404);
    });
  });

  describe('who may reach a permission-guarded route at all', () => {
    it('no session answers 401 UNAUTHENTICATED', async () => {
      const response = await http().get('/__access/customers').expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('a session whose staff profile has since been removed answers 401 STAFF_NOT_ACTIVE', async () => {
      // A user without a profile cannot sign in at all (US-001), so the
      // profile disappears after the session exists.
      const user = await signUp('JUNIOR');
      await prisma.staffProfile.delete({ where: { id: user.staffProfileId } });
      const response = await http()
        .get('/__access/customers')
        .set('Cookie', user.cookie)
        .expect(401);
      expect(response.body.code).toBe('STAFF_NOT_ACTIVE');
    });

    it('suspension takes effect on the next request, with the session still valid — and so does reactivation', async () => {
      const junior = await signUp('JUNIOR');
      await assign(junior, rows.line3, 'JUNIOR');
      await http()
        .get('/__access/customers')
        .set('Cookie', junior.cookie)
        .expect(200);

      await prisma.staffProfile.update({
        where: { id: junior.staffProfileId },
        data: { status: 'SUSPENDED' },
      });
      const suspended = await http()
        .get('/__access/customers')
        .set('Cookie', junior.cookie)
        .expect(401);
      expect(suspended.body.code).toBe('STAFF_NOT_ACTIVE');

      await prisma.staffProfile.update({
        where: { id: junior.staffProfileId },
        data: { status: 'ACTIVE' },
      });
      await http()
        .get('/__access/customers')
        .set('Cookie', junior.cookie)
        .expect(200);
    });

    it('a Senior with no current assignment sees nothing: an empty list and 404s', async () => {
      const senior = await signUp('SENIOR');
      await http()
        .get('/__access/customers')
        .set('Cookie', senior.cookie)
        .expect(200, []);
      await http()
        .get(`/__access/customers/${rows.customerOn3}`)
        .set('Cookie', senior.cookie)
        .expect(404);
    });

    it('only a Junior may reach the record-collection permission', async () => {
      const senior = await signUp('SENIOR');
      await assign(senior, rows.line7, 'SENIOR');
      await http()
        .get('/__access/context')
        .set('Cookie', senior.cookie)
        .expect(403);

      const junior = await signUp('JUNIOR');
      await assign(junior, rows.line3, 'JUNIOR');
      const response = await http()
        .get('/__access/context')
        .set('Cookie', junior.cookie)
        .expect(200);
      expect(response.body).toEqual({
        requestId: response.headers['x-request-id'],
        userId: junior.userId,
        staffProfileId: junior.staffProfileId,
        organizationId,
        role: 'JUNIOR',
        currentLineId: rows.line3,
      });
    });
  });

  describe('logging', () => {
    it('lines written after authorization carry the user id', async () => {
      const junior = await signUp('JUNIOR');
      await assign(junior, rows.line3, 'JUNIOR');
      const response = await http()
        .get('/__access/customers')
        .set('Cookie', junior.cookie)
        .expect(200);
      await new Promise((resolve) => setImmediate(resolve));

      const completed = logs
        .lines()
        .find(
          (line) =>
            line['requestId'] === response.headers['x-request-id'] &&
            line['res'] !== undefined,
        );
      expect(completed?.['userId']).toBe(junior.userId);
    });
  });
});
