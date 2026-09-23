import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { LineService } from '../../src/organisation/line.service.js';
import { SectorService } from '../../src/organisation/sector.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import {
  createActiveAccount,
  createLine,
  createStaff,
} from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * Sectors and lines (M03, US-010, US-011) against real rows, rolled back.
 * Unique-code conflicts are proven over HTTP instead: a unique violation aborts
 * the surrounding PostgreSQL transaction, which here is the test's own.
 */
describe('SectorService and LineService (US-010, US-011)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient) {
    const { organization, sector, line } = await createLine(tx);
    const admin = await createStaff(tx, organization.id, 'SENIOR');
    const context: RequestContext = {
      requestId: 'req_test',
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId: organization.id,
      role: 'ADMIN',
      currentLineId: null,
    };
    const database = new Database(tx);
    const audit = new AuditWriter(database);
    return {
      organization,
      sector,
      line,
      context,
      sectors: new SectorService(database, audit),
      lines: new LineService(database, audit),
    };
  }

  describe('sectors (US-010)', () => {
    it('creates a sector in the caller’s organization, issuing its code, and audits the CREATE', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors } = await world(tx);

        const sector = await sectors.create(context, { name: 'North' });
        const code = 'SEC-00001';

        expect(sector).toEqual({
          id: expect.any(String),
          code,
          name: 'North',
          isActive: true,
        });
        const stored = await tx.sector.findUniqueOrThrow({
          where: { id: sector.id },
        });
        expect(stored.organizationId).toBe(context.organizationId);
        expect(
          await tx.auditLog.findFirst({ where: { entityId: sector.id } }),
        ).toMatchObject({
          action: 'CREATE',
          entityTable: 'sector',
          actorUserId: context.userId,
          after: { code, name: 'North' },
        });
      });
    });

    it('issues each sector the next code, per organization and ignoring codes it did not issue', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors } = await world(tx);
        // The fixture's own sector is `S-<uuid>`: not a code this issues, so
        // numbering starts at 1 rather than being thrown by it.
        const first = await sectors.create(context, { name: 'North' });
        const second = await sectors.create(context, { name: 'South' });
        expect([first.code, second.code]).toEqual(['SEC-00001', 'SEC-00002']);

        const elsewhere = await createLine(tx);
        const other = await sectors.create(
          { ...context, organizationId: elsewhere.organization.id },
          { name: 'Theirs' },
        );
        expect(other.code).toBe('SEC-00001');
      });
    });

    it('renames a sector, auditing before and after', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors, sector } = await world(tx);
        const renamed = await sectors.rename(context, sector.id, 'Renamed');
        expect(renamed.name).toBe('Renamed');
        expect(
          await tx.auditLog.findFirst({
            where: { entityId: sector.id, action: 'UPDATE' },
          }),
        ).toMatchObject({
          before: { name: 'Sector' },
          after: { name: 'Renamed' },
        });
      });
    });

    it('refuses to deactivate a sector with an active line, then allows it once the line is inactive', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors, lines, sector, line } = await world(tx);

        await expect(
          sectors.deactivate(context, sector.id),
        ).rejects.toMatchObject({
          code: 'SECTOR_HAS_ACTIVE_LINES',
          status: 422,
        });

        await lines.deactivate(context, line.id);
        expect(await sectors.deactivate(context, sector.id)).toMatchObject({
          isActive: false,
        });
      });
    });

    it('answers 404 for a sector in another organization', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors } = await world(tx);
        const elsewhere = await createLine(tx);
        await expect(
          sectors.rename(context, elsewhere.sector.id, 'Mine now'),
        ).rejects.toMatchObject({
          code: 'SECTOR_NOT_FOUND',
          status: 404,
        });
      });
    });

    it('lists only the caller’s organization, active by default', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, sectors, sector } = await world(tx);
        const inactive = await tx.sector.create({
          data: {
            organizationId: context.organizationId,
            code: `S-${randomUUID()}`,
            name: 'Old',
            isActive: false,
          },
        });
        await createLine(tx); // another organization's sector

        const active = await sectors.list(context, {
          limit: 50,
          includeInactive: false,
        });
        const all = await sectors.list(context, {
          limit: 50,
          includeInactive: true,
        });
        expect(active.data.map((s) => s.id)).toEqual([sector.id]);
        expect(all.data.map((s) => s.id).sort()).toEqual(
          [sector.id, inactive.id].sort(),
        );
      });
    });
  });

  describe('lines (US-011)', () => {
    it('creates a line in an active sector, issuing its code, and audits the CREATE', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, lines, sector } = await world(tx);
        const line = await lines.create(context, {
          sectorId: sector.id,
          name: 'Line 9',
        });
        expect(line).toMatchObject({
          sectorId: sector.id,
          code: 'LIN-00001',
          name: 'Line 9',
          isActive: true,
        });
        const next = await lines.create(context, {
          sectorId: sector.id,
          name: 'Line 10',
        });
        expect(next.code).toBe('LIN-00002');
        expect(
          await tx.auditLog.count({
            where: { entityId: line.id, action: 'CREATE' },
          }),
        ).toBe(1);
      });
    });

    it('refuses a line in an inactive sector', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, lines, sector } = await world(tx);
        await tx.sector.update({
          where: { id: sector.id },
          data: { isActive: false },
        });
        await expect(
          lines.create(context, { sectorId: sector.id, name: 'x' }),
        ).rejects.toMatchObject({ code: 'SECTOR_INACTIVE', status: 422 });
      });
    });

    it('refuses to deactivate a line with an ACTIVE account', async () => {
      await withRollback(prisma, async (tx) => {
        const withAccount = await createActiveAccount(tx);
        const admin = await createStaff(
          tx,
          withAccount.organization.id,
          'SENIOR',
        );
        const database = new Database(tx);
        const lines = new LineService(database, new AuditWriter(database));
        const context: RequestContext = {
          requestId: 'req_test',
          userId: admin.userId,
          staffProfileId: admin.id,
          organizationId: withAccount.organization.id,
          role: 'SUPER_ADMIN',
          currentLineId: null,
        };

        await expect(
          lines.deactivate(context, withAccount.line.id),
        ).rejects.toMatchObject({
          code: 'LINE_HAS_ACTIVE_ACCOUNTS',
          status: 422,
        });
        expect(
          await tx.line.findUniqueOrThrow({
            where: { id: withAccount.line.id },
          }),
        ).toMatchObject({
          isActive: true,
        });
      });
    });

    it('deactivating an already inactive line changes and audits nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, lines, line } = await world(tx);
        await lines.deactivate(context, line.id);
        await lines.deactivate(context, line.id);
        expect(await tx.auditLog.count({ where: { entityId: line.id } })).toBe(
          1,
        );
      });
    });
  });

  it('an audit write outside a transaction is refused', async () => {
    await withRollback(prisma, async (tx) => {
      // A client that is not a transaction: the base client, untouched by withRollback.
      const writer = new AuditWriter(new Database(prisma));
      const { context } = await world(tx);
      await expect(
        writer.record(context, {
          action: 'CREATE',
          entityTable: 'sector',
          entityId: 'x',
        }),
      ).rejects.toMatchObject({ code: 'AUDIT_OUTSIDE_TRANSACTION' });
    });
  });
});
