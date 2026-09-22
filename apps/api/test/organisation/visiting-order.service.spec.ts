import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { VisitingOrderService } from '../../src/organisation/visiting-order.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * US-040 — a line's visiting order, set by its Senior or an Admin, against
 * real rows, rolled back. That the Junior's route follows it is proven with the
 * route in `collections/collection.service.spec.ts`; that a transfer clears a
 * customer's place, over HTTP in `customers.e2e-spec.ts`.
 */
describe('VisitingOrderService (US-040)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const other = await tx.line.create({
      data: {
        organizationId: organization.id,
        sectorId: sector.id,
        code: `L-${randomUUID()}`,
        name: 'Other line',
      },
    });
    const staff = await createStaff(tx, organization.id, 'SENIOR');
    const context = (
      role: RequestContext['role'],
      currentLineId: string | null,
    ): RequestContext => ({
      requestId: 'req_test',
      userId: staff.userId,
      staffProfileId: staff.id,
      organizationId: organization.id,
      role,
      currentLineId,
    });
    /** Codes sort in the order the customers are made: A, B, C. */
    const prefix = `C-${randomUUID()}`;
    const customer = (name: string, onLine = line.id) =>
      tx.customer.create({
        data: {
          organizationId: organization.id,
          customerCode: `${prefix}-${name}`,
          name,
          mobile: '+919800000000',
          address: `${name} Street`,
          sectorId: sector.id,
          lineId: onLine,
        },
      });
    const database = new Database(tx);
    return {
      line,
      other,
      customer,
      admin: context('ADMIN', null),
      senior: context('SENIOR', line.id),
      otherSenior: context('SENIOR', other.id),
      order: new VisitingOrderService(database, new AuditWriter(database)),
    };
  }

  it('lists customers not yet placed in code order, then keeps the order it is given', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const a = await w.customer('A');
      const b = await w.customer('B');
      const c = await w.customer('C');
      await w.customer('elsewhere', w.other.id);

      const before = await w.order.get(w.admin, w.line.id);
      expect(before.customers.map((row) => [row.name, row.position])).toEqual([
        ['A', null],
        ['B', null],
        ['C', null],
      ]);

      const after = await w.order.set(w.senior, w.line.id, [c.id, a.id, b.id]);
      expect(after.customers.map((row) => [row.name, row.position])).toEqual([
        ['C', 1],
        ['A', 2],
        ['B', 3],
      ]);
      expect(
        await tx.auditLog.findFirst({
          where: { entityId: w.line.id, entityTable: 'line' },
        }),
      ).toMatchObject({
        action: 'UPDATE',
        actorUserId: w.senior.userId,
        before: { visitingOrder: [] },
        after: { visitingOrder: [c.id, a.id, b.id] },
      });
    });
  });

  it('swaps two customers in place — the unique place per line does not collide half-way', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const a = await w.customer('A');
      const b = await w.customer('B');
      await w.order.set(w.admin, w.line.id, [a.id, b.id]);

      const swapped = await w.order.set(w.admin, w.line.id, [b.id, a.id]);

      expect(swapped.customers.map((row) => row.name)).toEqual(['B', 'A']);
    });
  });

  it('a new customer waits at the end of an ordered line until placed', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const a = await w.customer('A');
      const b = await w.customer('B');
      await w.order.set(w.admin, w.line.id, [b.id, a.id]);
      await w.customer('C');

      const order = await w.order.get(w.senior, w.line.id);

      expect(order.customers.map((row) => [row.name, row.position])).toEqual([
        ['B', 1],
        ['A', 2],
        ['C', null],
      ]);
    });
  });

  it('refuses a list that is not exactly the line’s customers, once each', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const a = await w.customer('A');
      await w.customer('B');
      const elsewhere = await w.customer('elsewhere', w.other.id);
      const refused = { code: 'VISITING_ORDER_MISMATCH', status: 422 };

      // Someone left out — a screen loaded before B joined.
      await expect(
        w.order.set(w.admin, w.line.id, [a.id]),
      ).rejects.toMatchObject(refused);
      // Someone twice.
      await expect(
        w.order.set(w.admin, w.line.id, [a.id, a.id]),
      ).rejects.toMatchObject(refused);
      // Someone from another line.
      await expect(
        w.order.set(w.admin, w.line.id, [a.id, elsewhere.id]),
      ).rejects.toMatchObject(refused);
      // Nothing was written.
      expect(
        (await w.order.get(w.admin, w.line.id)).customers.map(
          (row) => row.position,
        ),
      ).toEqual([null, null]);
    });
  });

  it('a Senior of another line is told the line does not exist (404, M02)', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const a = await w.customer('A');

      await expect(w.order.get(w.otherSenior, w.line.id)).rejects.toMatchObject(
        {
          code: 'LINE_NOT_FOUND',
          status: 404,
        },
      );
      await expect(
        w.order.set(w.otherSenior, w.line.id, [a.id]),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
    });
  });
});
