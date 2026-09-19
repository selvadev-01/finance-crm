import { EXPORT_ROW_LIMIT } from '@repo/contracts';
import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import type { ExportDocument } from '../../src/exports/export-document.js';
import {
  ExportService,
  readAllPages,
} from '../../src/exports/export.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * `ExportService` against real rows, rolled back: the EXPORT audit entry is
 * written by the real `AuditWriter` into `audit_log`, which rejects DELETE,
 * so it is proven here and never in the HTTP tier (M12, M13).
 */
describe('ExportService (M12 export)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function doc(rows: number): ExportDocument {
    return {
      title: 'Line-wise report',
      filename: 'rasi-line-wise-2026-09-01-to-2026-09-19',
      facts: [],
      sections: [
        {
          kind: 'table',
          title: 'Lines',
          columns: [
            { header: 'Line', kind: 'text' },
            { header: 'Collected', kind: 'money' },
          ],
          rows: Array.from({ length: rows }, (_, index) => [
            `LN-${index}`,
            '100.00',
          ]),
        },
      ],
    };
  }

  async function world(tx: PrismaClient) {
    const { organization } = await createLine(tx);
    const admin = await createStaff(tx, organization.id, 'ADMIN');
    const context: RequestContext = {
      requestId: `req_${randomUUID()}`,
      userId: admin.userId,
      staffProfileId: admin.id,
      organizationId: organization.id,
      role: 'ADMIN',
      currentLineId: null,
    };
    const database = new Database(tx);
    return {
      context,
      organizationId: organization.id,
      service: new ExportService(database, new AuditWriter(database)),
    };
  }

  it('returns the file as an attachment and records who took it, in what format, with which filters', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const file = await w.service.deliver(
        w.context,
        {
          name: 'reports/line-wise',
          format: 'xlsx',
          filters: { from: '2026-09-01', to: '2026-09-19', lineId: undefined },
        },
        doc(3),
      );
      const headers = file.getHeaders();
      expect(headers.type).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(headers.disposition).toBe(
        'attachment; filename="rasi-line-wise-2026-09-01-to-2026-09-19.xlsx"',
      );

      const entries = await tx.auditLog.findMany({
        where: { organizationId: w.organizationId, action: 'EXPORT' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorUserId: w.context.userId,
        entityTable: 'export',
        entityId: 'reports/line-wise',
        after: {
          format: 'xlsx',
          // An unset filter is left out, not recorded as null.
          filters: { from: '2026-09-01', to: '2026-09-19' },
          rows: 3,
          filename: 'rasi-line-wise-2026-09-01-to-2026-09-19.xlsx',
        },
      });
    });
  });

  it('names a PDF as a PDF', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const file = await w.service.deliver(
        w.context,
        { name: 'dashboards/overview', format: 'pdf', filters: {} },
        doc(1),
      );
      expect(file.getHeaders().type).toBe('application/pdf');
      expect(file.getHeaders().disposition).toContain('.pdf"');
    });
  });

  it(`refuses more than ${EXPORT_ROW_LIMIT} rows with EXPORT_TOO_LARGE and records nothing`, async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      await expect(
        w.service.deliver(
          w.context,
          { name: 'collections', format: 'xlsx', filters: {} },
          doc(EXPORT_ROW_LIMIT + 1),
        ),
      ).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 422 });
      expect(
        await tx.auditLog.count({
          where: { organizationId: w.organizationId, action: 'EXPORT' },
        }),
      ).toBe(0);
    });
  });

  it('records nothing when the file cannot be made', async () => {
    await withRollback(prisma, async (tx) => {
      const w = await world(tx);
      const broken: ExportDocument = {
        ...doc(0),
        sections: [
          {
            kind: 'table',
            title: 'Lines',
            columns: [{ header: 'Collected', kind: 'money' }],
            rows: [[100]],
          },
        ],
      };
      await expect(
        w.service.deliver(
          w.context,
          { name: 'reports/line-wise', format: 'pdf', filters: {} },
          broken,
        ),
      ).rejects.toThrow(/export cell of kind/);
      expect(
        await tx.auditLog.count({
          where: { organizationId: w.organizationId, action: 'EXPORT' },
        }),
      ).toBe(0);
    });
  });
});

describe('readAllPages (M12 export)', () => {
  /** A paged view over `total` rows, `size` at a time, counting its reads. */
  function view(total: number, size: number) {
    const reads: (string | undefined)[] = [];
    const read = (cursor: string | undefined) => {
      reads.push(cursor);
      const start = cursor === undefined ? 0 : Number(cursor);
      const data = Array.from(
        { length: Math.max(0, Math.min(size, total - start)) },
        (_, index) => start + index,
      );
      const next = start + size;
      return Promise.resolve({
        data,
        hasMore: next < total,
        nextCursor: next < total ? String(next) : null,
        summary: 'whole set',
      });
    };
    return { read, reads };
  }

  it('reads every page, and keeps the first for its summary', async () => {
    const { read, reads } = view(450, 200);
    const { first, rows } = await readAllPages(read);
    expect(rows).toEqual(Array.from({ length: 450 }, (_, index) => index));
    expect(first.summary).toBe('whole set');
    expect(reads).toEqual([undefined, '200', '400']);
  });

  it('stops reading as soon as the rows pass the limit, and refuses', async () => {
    const { read, reads } = view(EXPORT_ROW_LIMIT * 5, 200);
    await expect(readAllPages(read)).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
    });
    expect(reads.length).toBeLessThanOrEqual(EXPORT_ROW_LIMIT / 200 + 2);
  });
});
