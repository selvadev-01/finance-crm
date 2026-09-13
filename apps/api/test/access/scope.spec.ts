import type { PrismaClient } from '@repo/db';
import { parseCalendarDate } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { RequestContextResolver } from '../../src/access/request-context.resolver.js';
import {
  collectionScope,
  customerScope,
  inScope,
} from '../../src/access/scope.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import {
  createActiveAccount,
  createStaff,
  createUser,
  decimal,
} from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

// Fixed, so date-aware "current assignment" tests do not change meaning as the
// real calendar moves on.
const TODAY = parseCalendarDate('2026-09-13');

/**
 * US-004 against real rows (Tier 1, rolled back). Collections cannot be
 * deleted (BR-14), so the collection half of the scope can only be proven in a
 * transaction that never commits — which is here, not over HTTP.
 */
describe('request context and data scope (US-004)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const assign = (
    tx: PrismaClient,
    staffProfileId: string,
    lineId: string,
    role: 'SENIOR' | 'JUNIOR',
    effectiveFrom: string,
    effectiveTo: string | null = null,
  ) =>
    tx.lineAssignment.create({
      data: {
        staffProfileId,
        lineId,
        assignmentRole: role,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
    });

  const recordCollection = (
    tx: PrismaClient,
    accountLoanId: string,
    lineId: string,
    collectedByUserId: string,
    businessDate: string,
  ) =>
    tx.collection.create({
      data: {
        idempotencyKey: randomUUID(),
        accountLoanId,
        lineId,
        collectedByUserId,
        businessDate: new Date(businessDate),
        capturedAt: new Date(`${businessDate}T05:00:00Z`),
        syncedAt: new Date(`${businessDate}T05:00:00Z`),
        expectedAmount: decimal('100.00'),
        amount: decimal('100.00'),
        variance: decimal('0.00'),
        classification: 'CORRECT',
      },
    });

  describe('resolving the context', () => {
    it('resolves role and the current line from line_assignment where effectiveTo is null', async () => {
      await withRollback(prisma, async (tx) => {
        const { line: line3, organization } = await createActiveAccount(tx);
        const { line: line7 } = await createActiveAccount(tx);
        const senior = await createStaff(tx, organization.id, 'SENIOR');
        await assign(
          tx,
          senior.id,
          line3.id,
          'SENIOR',
          '2026-01-01',
          '2026-09-11',
        );
        await assign(tx, senior.id, line7.id, 'SENIOR', '2026-09-12');

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(senior.userId, 'req_test', TODAY);
        expect(context).toEqual({
          requestId: 'req_test',
          userId: senior.userId,
          staffProfileId: senior.id,
          organizationId: organization.id,
          role: 'SENIOR',
          currentLineId: line7.id,
        });
      });
    });

    it('a move made effective tomorrow does not change the current line until tomorrow (US-013)', async () => {
      await withRollback(prisma, async (tx) => {
        const { line: line3, organization } = await createActiveAccount(tx);
        const { line: line7 } = await createActiveAccount(tx);
        const junior = await createStaff(tx, organization.id, 'JUNIOR');
        // As AssignmentService writes it on 13 Sep for "effective 14 Sep":
        // Line 3 closes today, Line 7 opens tomorrow.
        await assign(
          tx,
          junior.id,
          line3.id,
          'JUNIOR',
          '2026-01-01',
          '2026-09-13',
        );
        await assign(tx, junior.id, line7.id, 'JUNIOR', '2026-09-14');
        const resolver = new RequestContextResolver(new Database(tx));

        const today = await resolver.resolve(junior.userId, 'req_test', TODAY);
        const tomorrow = await resolver.resolve(
          junior.userId,
          'req_test',
          parseCalendarDate('2026-09-14'),
        );
        expect(today?.currentLineId).toBe(line3.id);
        expect(tomorrow?.currentLineId).toBe(line7.id);
      });
    });

    it('an assignment that has not started yet is not current', async () => {
      await withRollback(prisma, async (tx) => {
        const { line, organization } = await createActiveAccount(tx);
        const senior = await createStaff(tx, organization.id, 'SENIOR');
        await assign(tx, senior.id, line.id, 'SENIOR', '2026-10-01');

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(senior.userId, 'req_test', TODAY);
        expect(context?.currentLineId).toBeNull();
      });
    });

    it('a staff member whose only assignment has ended has no current line', async () => {
      await withRollback(prisma, async (tx) => {
        const { line, organization } = await createActiveAccount(tx);
        const junior = await createStaff(tx, organization.id, 'JUNIOR');
        await assign(
          tx,
          junior.id,
          line.id,
          'JUNIOR',
          '2026-01-01',
          '2026-06-30',
        );

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(junior.userId, 'req_test', TODAY);
        expect(context?.currentLineId).toBeNull();
      });
    });

    it.each([
      ['SUSPENDED', { status: 'SUSPENDED' as const }],
      ['INACTIVE', { status: 'INACTIVE' as const }],
      ['soft-deleted', { deletedAt: new Date() }],
    ])('a %s staff member resolves to no context', async (_label, change) => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createActiveAccount(tx);
        const staff = await createStaff(tx, organization.id, 'JUNIOR');
        await tx.staffProfile.update({ where: { id: staff.id }, data: change });

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(staff.userId, 'req_test', TODAY);
        expect(context).toBeNull();
      });
    });

    it('a user with no staff profile resolves to no context', async () => {
      await withRollback(prisma, async (tx) => {
        const user = await createUser(tx);
        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(user.id, 'req_test', TODAY);
        expect(context).toBeNull();
      });
    });
  });

  describe('scope follows reassignment, by each row’s own attribution', () => {
    it('a Senior moved from Line 3 to Line 7 sees Line 7 collections from before the move, and none from Line 3', async () => {
      await withRollback(prisma, async (tx) => {
        const three = await createActiveAccount(tx);
        const seven = await createActiveAccount(tx);
        const collector = await createUser(tx);

        const onThree = await recordCollection(
          tx,
          three.account.id,
          three.line.id,
          collector.id,
          '2026-09-02',
        );
        // Recorded on Line 7 *before* the Senior arrived there.
        const onSevenBefore = await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          collector.id,
          '2026-09-03',
        );
        const onSevenAfter = await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          collector.id,
          '2026-09-13',
        );

        const senior = await createStaff(tx, three.organization.id, 'SENIOR');
        await assign(
          tx,
          senior.id,
          three.line.id,
          'SENIOR',
          '2026-01-01',
          '2026-09-11',
        );
        await assign(tx, senior.id, seven.line.id, 'SENIOR', '2026-09-12');

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(senior.userId, 'req_test', TODAY);
        if (!context) throw new Error('expected a context');

        const visible = await tx.collection.findMany({
          where: inScope(collectionScope(context), {
            lineId: { in: [three.line.id, seven.line.id] },
          }),
          select: { id: true },
        });
        expect(visible.map((row) => row.id).sort()).toEqual(
          [onSevenBefore.id, onSevenAfter.id].sort(),
        );
        expect(visible.map((row) => row.id)).not.toContain(onThree.id);

        const customers = await tx.customer.findMany({
          where: inScope(customerScope(context), {
            id: { in: [three.customer.id, seven.customer.id] },
          }),
          select: { id: true },
        });
        expect(customers).toEqual([{ id: seven.customer.id }]);
      });
    });

    it('a Junior sees only their own entries on their current line', async () => {
      await withRollback(prisma, async (tx) => {
        const three = await createActiveAccount(tx);
        const seven = await createActiveAccount(tx);
        const junior = await createStaff(tx, seven.organization.id, 'JUNIOR');
        const otherJunior = await createUser(tx);
        await assign(tx, junior.id, seven.line.id, 'JUNIOR', '2026-09-01');

        const mineOnSeven = await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          junior.userId,
          '2026-09-02',
        );
        await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          otherJunior.id,
          '2026-09-02',
        );
        await recordCollection(
          tx,
          three.account.id,
          three.line.id,
          junior.userId,
          '2026-08-20',
        );

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(junior.userId, 'req_test', TODAY);
        if (!context) throw new Error('expected a context');

        const visible = await tx.collection.findMany({
          where: inScope(collectionScope(context), {
            lineId: { in: [three.line.id, seven.line.id] },
          }),
          select: { id: true },
        });
        expect(visible).toEqual([{ id: mineOnSeven.id }]);
      });
    });

    it('an Admin sees collections on every line of their own organization, and none of another', async () => {
      await withRollback(prisma, async (tx) => {
        const three = await createActiveAccount(tx);
        const seven = await createActiveAccount(tx);
        const collector = await createUser(tx);
        await recordCollection(
          tx,
          three.account.id,
          three.line.id,
          collector.id,
          '2026-09-02',
        );
        await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          collector.id,
          '2026-09-02',
        );

        const admin = await tx.staffProfile.update({
          where: {
            id: (await createStaff(tx, three.organization.id, 'SENIOR')).id,
          },
          data: { role: 'ADMIN' },
        });
        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(admin.userId, 'req_test', TODAY);
        if (!context) throw new Error('expected a context');

        const visible = await tx.collection.count({
          where: inScope(collectionScope(context), {
            lineId: { in: [three.line.id, seven.line.id] },
          }),
        });
        // Line 7 belongs to another organization (createActiveAccount makes one each).
        expect(visible).toBe(1);
      });
    });

    it('a Senior with no current assignment sees no collections at all', async () => {
      await withRollback(prisma, async (tx) => {
        const seven = await createActiveAccount(tx);
        const collector = await createUser(tx);
        await recordCollection(
          tx,
          seven.account.id,
          seven.line.id,
          collector.id,
          '2026-09-02',
        );
        const senior = await createStaff(tx, seven.organization.id, 'SENIOR');

        const context = await new RequestContextResolver(
          new Database(tx),
        ).resolve(senior.userId, 'req_test', TODAY);
        if (!context) throw new Error('expected a context');

        expect(
          await tx.collection.count({
            where: inScope(collectionScope(context)),
          }),
        ).toBe(0);
      });
    });
  });
});
