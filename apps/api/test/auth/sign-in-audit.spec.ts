import type { PrismaClient } from '@repo/db';

import {
  UNKNOWN_USER,
  writeSignInAudit,
} from '../../src/auth/sign-in-audit.js';
import { createTestPrismaClient } from '../database.js';
import {
  createLine,
  createStaff,
  createUser,
} from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * The real `LOGIN` write, against `audit_log` (Tier 1, rolled back). HTTP tests
 * record attempts in memory because audit rows cannot be deleted; this is
 * where the row the table actually receives is proven.
 */
describe('sign-in audit write (M13, US-001)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes a LOGIN row for a matched user, with outcome, reason, IP and user agent', async () => {
    await withRollback(prisma, async (tx) => {
      const user = await createUser(tx);
      await writeSignInAudit(tx, {
        userId: user.id,
        outcome: 'SUCCESS',
        reason: null,
        ipAddress: '203.0.113.7',
        userAgent: 'rasi-test',
      });

      const row = await tx.auditLog.findFirstOrThrow({
        where: { entityId: user.id, action: 'LOGIN' },
      });
      expect(row).toMatchObject({
        actorUserId: user.id,
        entityTable: 'user',
        before: null,
        after: { outcome: 'SUCCESS', reason: null },
        ipAddress: '203.0.113.7',
        userAgent: 'rasi-test',
        organizationId: null,
      });
    });
  });

  it("records the matched staff member's organization, so the attempt shows in that organization's log (US-090)", async () => {
    await withRollback(prisma, async (tx) => {
      const { organization } = await createLine(tx);
      const staff = await createStaff(tx, organization.id, 'JUNIOR');
      await writeSignInAudit(tx, {
        userId: staff.userId,
        outcome: 'REFUSED',
        reason: 'STAFF_NOT_ACTIVE',
        ipAddress: null,
        userAgent: null,
      });
      const row = await tx.auditLog.findFirstOrThrow({
        where: { entityId: staff.userId, action: 'LOGIN' },
      });
      expect(row.organizationId).toBe(organization.id);
    });
  });

  it('writes a row with no actor for an attempt that matched no user', async () => {
    await withRollback(prisma, async (tx) => {
      const before = await tx.auditLog.count({
        where: { entityId: UNKNOWN_USER },
      });
      await writeSignInAudit(tx, {
        userId: null,
        outcome: 'FAILURE',
        reason: 'INVALID_EMAIL_OR_PASSWORD',
        ipAddress: null,
        userAgent: null,
      });

      const rows = await tx.auditLog.findMany({
        where: { entityId: UNKNOWN_USER, actorUserId: null, action: 'LOGIN' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(
        await tx.auditLog.count({ where: { entityId: UNKNOWN_USER } }),
      ).toBe(before + 1);
      expect(rows[0]?.after).toEqual({
        outcome: 'FAILURE',
        reason: 'INVALID_EMAIL_OR_PASSWORD',
      });
    });
  });
});
