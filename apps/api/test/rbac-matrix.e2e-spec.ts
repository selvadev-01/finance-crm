import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import {
  PERMISSIONS,
  type Permission,
  roleHasPermission,
} from '../src/access/permissions.js';
import {
  type RouteEntry,
  RouteAccessAudit,
} from '../src/access/route-access.audit.js';
import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * The RBAC matrix harness (M02, PRD release gate 5).
 *
 * **Generated from the routes the application actually serves**, not from a
 * list: every route × every role becomes its own test, plus a no-session test
 * per route. A new endpoint is covered the moment it exists, and one that
 * declares no permission never gets this far — the app refuses to start.
 *
 * Each cell asserts the real HTTP status of the **action** half of the matrix:
 *
 * - a role without the route's permission → `403 PERMISSION_DENIED`;
 * - a role with it → anything but `401`/`403` (it reaches validation or the
 *   handler; bodies are empty and ids do not exist, so nothing is changed);
 * - no session on a protected route → `401 UNAUTHENTICATED`;
 * - a public route → never `401`/`403`.
 *
 * The **row** half — "own line", "own assigned" — needs real data per module,
 * and is asserted in each module's own HTTP suite.
 *
 * Permissions are held to `docs/01-product/rbac-matrix.md` by
 * `src/access/permissions.spec.ts`, so this harness plus that test is the
 * whole matrix: document → permission map → every served route.
 */
const ROLES: StaffRole[] = ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'];

/** A path parameter value that matches no row, so allowed requests change nothing. */
const MISSING_ID = 'rbac-probe-does-not-exist';

// Top-level await: the route list must exist before tests are declared.
const catalogue = await createTestApp();
const routes: RouteEntry[] = catalogue
  .get(RouteAccessAudit)
  .routes()
  .sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
  );
await catalogue.close();

const protectedRoutes = routes.filter(
  (route): route is RouteEntry & { permission: Permission } =>
    route.permission !== null,
);
const publicRoutes = routes.filter((route) => route.isPublic);

function requestFor(
  app: INestApplication<Server>,
  route: RouteEntry,
  cookie?: string,
) {
  const path = route.path.replace(/:[A-Za-z]+/g, MISSING_ID);
  const method = route.method.toLowerCase() as
    'get' | 'post' | 'patch' | 'put' | 'delete';
  const pending = request(app.getHttpServer())[method](path);
  if (cookie) pending.set('Cookie', cookie);
  return route.method === 'GET' ? pending : pending.send({});
}

describe('RBAC matrix harness (M02, release gate 5)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  const cookies = {} as Record<StaffRole, string>;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const { organization, lines } = await createTestOrganization(prisma, [
      'Harness line',
    ]);
    for (const role of ROLES) {
      const staff = await createTestStaff(prisma, {
        organizationId: organization.id,
        role,
      });
      if (role === 'SENIOR' || role === 'JUNIOR') {
        await prisma.lineAssignment.create({
          data: {
            staffProfileId: staff.staffProfileId,
            lineId: lines[0]!.id,
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
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('discovers the application’s routes', () => {
    expect(protectedRoutes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.isPublic || route.permission)).toBe(
      true,
    );
  });

  describe.each(protectedRoutes)('$method $path — $permission', (route) => {
    it.each(ROLES)('%s', async (role) => {
      const response = await requestFor(app, route, cookies[role]);
      if (roleHasPermission(role, route.permission)) {
        expect(
          [401, 403],
          `${role} holds ${route.permission} but got ${response.status} ${JSON.stringify(response.body)}`,
        ).not.toContain(response.status);
      } else {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      }
    });

    it('no session → 401', async () => {
      const response = await requestFor(app, route);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe.each(publicRoutes)('$method $path — public', (route) => {
    it('answers without a session', async () => {
      const response = await requestFor(app, route);
      expect([401, 403]).not.toContain(response.status);
    });
  });

  /**
   * The cells above trust each route's declared permission. This pins it: a
   * route guarded by the wrong permission, a new route, or a removed one fails
   * here until this table is changed — deliberately, in review. Use the RBAC
   * matrix to decide the entry, never the code.
   */
  it('every served route declares exactly the access recorded here', () => {
    const served = Object.fromEntries(
      routes.map((route) => [
        `${route.method} ${route.path}`,
        route.isPublic ? 'public' : route.permission,
      ]),
    );
    expect(served).toEqual(EXPECTED_ACCESS);
  });

  it('every permission in the table exists in the matrix map', () => {
    for (const access of Object.values(EXPECTED_ACCESS)) {
      if (access !== 'public') expect(PERMISSIONS).toHaveProperty([access]);
    }
  });
});

const EXPECTED_ACCESS: Record<string, Permission | 'public'> = {
  'GET /health/live': 'public',
  'GET /health/ready': 'public',
  'GET /health/info': 'public',
  // No session yet: the caller is signing up or opening a sign-in link (ADR-0012).
  'POST /api/organizations': 'public',
  'GET /api/organizations/:slug': 'public',
  'GET /api/notifications': 'notification.viewOwn',
  'POST /api/notifications/:notificationId/read': 'notification.viewOwn',
  'POST /api/notifications/read-all': 'notification.viewOwn',
  'GET /api/push/config': 'notification.registerDevice',
  'GET /api/push-subscriptions': 'notification.registerDevice',
  'POST /api/push-subscriptions': 'notification.registerDevice',
  'DELETE /api/push-subscriptions/:subscriptionId':
    'notification.registerDevice',
  'GET /api/notification-preferences': 'notification.managePreferences',
  'PATCH /api/notification-preferences': 'notification.managePreferences',
  // M01 Identity
  'GET /api/me': 'profile.viewOwn',
  'POST /api/staff': 'staff.create',
  'PATCH /api/staff/:staffProfileId': 'staff.update',
  // Only a Super Admin changes a role — otherwise an Admin promotes themselves.
  'POST /api/staff/:staffProfileId/role': 'staff.changeRole',
  'POST /api/staff/:staffProfileId/status': 'staff.suspend',
  'POST /api/staff/:staffProfileId/password-reset': 'staff.resetPassword',
  // M03 Organisation
  'GET /api/sectors': 'organisation.view',
  'GET /api/sectors/:sectorId': 'organisation.view',
  'POST /api/accounts/preview': 'account.create',
  'POST /api/accounts': 'account.create',
  'POST /api/accounts/:accountId/disbursement': 'account.disburse',
  'GET /api/accounts': 'account.view',
  'GET /api/accounts/:accountId': 'account.view',
  'GET /api/accounts/:accountId/history': 'audit.view',
  'GET /api/audit-log': 'audit.view',
  // M13: the refused attempts, read by whoever reads the audit log.
  'GET /api/security-events': 'audit.view',
  'GET /api/accounts/:accountId/schedule': 'account.viewSchedule',
  'POST /api/collections': 'collection.record',
  'GET /api/route': 'collection.record',
  'GET /api/collections': 'collection.view',
  'GET /api/collections/:collectionId': 'collection.view',
  'POST /api/collections/:collectionId/corrections':
    'collection.requestCorrection',
  'POST /api/collections/:collectionId/reversal': 'collection.reverse',
  'GET /api/collection-approvals': 'collection.approveCorrection',
  // M08 Day close and cash
  'POST /api/devices/sync-report': 'collection.record',
  'GET /api/lines/:lineId/day-closes/:businessDate': 'dayClose.view',
  'POST /api/lines/:lineId/day-closes/:businessDate/close': 'dayClose.close',
  'POST /api/lines/:lineId/day-closes/:businessDate/reopen': 'dayClose.reopen',
  'GET /api/cash': 'handover.initiate',
  'POST /api/handovers': 'handover.initiate',
  'GET /api/handovers': 'handover.acknowledge',
  'POST /api/handovers/:handoverId/acknowledge': 'handover.acknowledge',
  'POST /api/handovers/:handoverId/dispute': 'handover.dispute',
  'POST /api/collection-approvals/:approvalId/decision':
    'collection.approveCorrection',
  'GET /api/customers': 'customer.view',
  'GET /api/customers/:customerId': 'customer.view',
  'POST /api/customers': 'customer.create',
  'GET /api/staff': 'staff.list',
  'GET /api/staff/:staffProfileId': 'staff.list',
  'GET /api/lines/:lineId': 'organisation.view',
  'POST /api/sectors': 'sector.manage',
  'PATCH /api/sectors/:sectorId': 'sector.manage',
  'POST /api/sectors/:sectorId/deactivation': 'sector.manage',
  'GET /api/lines': 'organisation.view',
  'POST /api/lines': 'line.manage',
  'PATCH /api/lines/:lineId': 'line.manage',
  'POST /api/lines/:lineId/deactivation': 'line.manage',
  'POST /api/lines/:lineId/senior-assignment': 'assignment.assignSenior',
  'POST /api/lines/:lineId/junior-assignment': 'assignment.moveJunior',
  'GET /api/staffing': 'staff.list',
  'GET /api/lines/:lineId/assignments': 'assignment.viewHistory',
  // M11 Dashboards (US-080, US-082): business totals are Admin and Super Admin.
  'GET /api/dashboards/overview': 'money.businessTotals',
  'GET /api/dashboards/operations': 'money.businessTotals',
  // M11 (US-081): sector totals are Admin and Super Admin.
  'GET /api/dashboards/sectors': 'money.sectorTotals',
  // M11 (US-083): line totals are Admins, and a Senior for their own line.
  'GET /api/dashboards/line': 'money.lineTotals',
  // M11: the dashboards' trend is line totals summed over the caller's scope.
  'GET /api/dashboards/trend': 'money.lineTotals',
  // M12 Reports (US-084): Admins, and a Senior for their own line.
  'GET /api/reports/line-wise': 'report.view',
  // M12 Reports (US-085): §22's invested and profit, Admins and a Senior's own line.
  'GET /api/reports/investment': 'report.view',
  // M12 Reports (US-086): BR-08 over a range, Admins and a Senior's own line.
  'GET /api/reports/collection': 'report.view',
  // M12 Reports (US-087): BR-05's overdue accounts, Admins and a Senior's own line.
  'GET /api/reports/overdue': 'report.view',
  // M12 Reports (discrepancy): BR-17's cash discrepancies, Admins and a Senior's own line.
  'GET /api/reports/discrepancy': 'report.view',
  // M12 export: each export carries the permission of the view it exports,
  // so no cell changes — a file never shows more than the screen.
  'GET /api/exports/reports/line-wise': 'report.view',
  'GET /api/exports/reports/investment': 'report.view',
  'GET /api/exports/reports/collection': 'report.view',
  'GET /api/exports/reports/overdue': 'report.view',
  'GET /api/exports/reports/discrepancy': 'report.view',
  'GET /api/exports/collections': 'collection.view',
  'GET /api/exports/dashboards/overview': 'money.businessTotals',
  'GET /api/exports/dashboards/operations': 'money.businessTotals',
  'GET /api/exports/dashboards/sectors': 'money.sectorTotals',
  'GET /api/exports/dashboards/line': 'money.lineTotals',
  // M15 Settings (US-094): the owner's alone, both halves.
  'GET /api/settings': 'settings.view',
  'PATCH /api/settings/:key': 'settings.change',
  // M06 Working calendar (US-093)
  'GET /api/holidays': 'holiday.view',
  'POST /api/holidays': 'holiday.declare',
  'DELETE /api/holidays/:holidayId': 'holiday.declare',
};
