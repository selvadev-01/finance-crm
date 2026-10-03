import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CustomerService } from '../../src/customers/customer.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * A Senior onboards customers onto the lines they are assigned to, and onto
 * no other (decided 2026-10-03). Tier 1, rolled back: a created customer
 * writes an audit row, which the HTTP tier must never keep.
 */
describe('CustomerService.create by a Senior (US-020)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A Senior assigned to Line A and Line B; Line C in the same organization is not theirs. */
  async function world(tx: PrismaClient) {
    const { organization, sector, line: lineA } = await createLine(tx);
    const line = (name: string) =>
      tx.line.create({
        data: {
          organizationId: organization.id,
          sectorId: sector.id,
          code: `L-${randomUUID()}`,
          name,
        },
      });
    const lineB = await line('Line B');
    const lineC = await line('Line C');
    const senior = await createStaff(tx, organization.id, 'SENIOR');
    const context: RequestContext = {
      requestId: 'req_test',
      userId: senior.userId,
      staffProfileId: senior.id,
      organizationId: organization.id,
      role: 'SENIOR',
      currentLineIds: [lineA.id, lineB.id],
    };
    const database = new Database(tx);
    const service = new CustomerService(
      database,
      new AuditWriter(database),
      testNotifications(database).notices,
    );
    const input = (lineId: string) => ({
      name: 'Lakshmi Narayanan',
      mobile: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      address: '12 Market Road, Mylapore',
      lineId,
      notes: undefined,
      references: [
        {
          name: 'Ravi Kumar',
          mobile: '+919876500001',
          relation: undefined,
          address: undefined,
        },
      ],
      confirmDuplicateMobile: false,
    });
    return { lineA, lineB, lineC, context, service, input };
  }

  it('creates a customer on each of their assigned lines, audited as theirs', async () => {
    await withRollback(prisma, async (tx) => {
      const { lineA, lineB, context, service, input } = await world(tx);

      const onA = await service.create(context, input(lineA.id));
      const onB = await service.create(context, input(lineB.id));

      expect(onA.lineId).toBe(lineA.id);
      expect(onB.lineId).toBe(lineB.id);
      expect(
        await tx.auditLog.findMany({
          where: { entityId: { in: [onA.id, onB.id] } },
          select: { action: true, actorUserId: true },
        }),
      ).toEqual([
        { action: 'CREATE', actorUserId: context.userId },
        { action: 'CREATE', actorUserId: context.userId },
      ]);
    });
  });

  it('refuses a line they are not assigned to as missing (404), and writes nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const { lineC, context, service, input } = await world(tx);

      await expect(
        service.create(context, input(lineC.id)),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
      expect(await tx.customer.count({ where: { lineId: lineC.id } })).toBe(0);
    });
  });

  it('a Senior on no line today can create nowhere', async () => {
    await withRollback(prisma, async (tx) => {
      const { lineA, context, service, input } = await world(tx);

      await expect(
        service.create({ ...context, currentLineIds: [] }, input(lineA.id)),
      ).rejects.toMatchObject({ code: 'LINE_NOT_FOUND', status: 404 });
    });
  });
});
