import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { startOfMonth, toBusinessDate } from '@repo/domain';
import ExcelJS from 'exceljs';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp, recordedAudit } from './app.js';
import {
  createTestPrismaClient,
  deleteTestRunData,
  testCode,
} from './database.js';
import { createTestOrganization, createTestStaff, signIn } from './staff.js';

/**
 * M12 export over HTTP — every report, dashboard and the collection list as
 * Excel and PDF. **Read-only**, on a tagged organization with no accounts:
 * the headers and bytes a browser receives, that each export answers with
 * its view's scope (a Senior's other line is `404`, a Junior `403`), and that
 * the EXPORT audit entry is written — captured by the test app's recording
 * `AuditWriter`, since `audit_log` rejects DELETE. The entry itself is proven
 * against the table in Tier 1 (`test/exports/export.service.spec.ts`).
 */
describe('M12 export (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let staffed: { id: string; code: string };
  let other: { id: string; code: string };
  let otherSector: { id: string };
  const cookies = {} as Record<StaffRole, string>;
  const userIds = {} as Record<StaffRole, string>;
  const today = toBusinessDate(new Date());

  /** GET a file; the body arrives as bytes whatever its type. */
  const download = (role: StaffRole | null, url: string) => {
    const pending = request(app.getHttpServer())
      .get(url)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return role ? pending.set('Cookie', cookies[role]) : pending;
  };
  const json = (body: Buffer) =>
    JSON.parse(body.toString('utf8')) as { code: string };

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Staffed', 'Other']);
    staffed = org.lines[0]!;
    other = org.lines[1]!;
    otherSector = await prisma.sector.create({
      data: {
        organizationId: org.organization.id,
        code: testCode('SEC'),
        name: 'Elsewhere',
      },
    });
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      const staff = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role,
      });
      if (role === 'SENIOR' || role === 'JUNIOR') {
        await prisma.lineAssignment.create({
          data: {
            staffProfileId: staff.staffProfileId,
            lineId: staffed.id,
            assignmentRole: role,
            effectiveFrom: new Date('2026-01-01'),
          },
        });
      }
      cookies[role] = await signIn(app, staff);
      userIds[role] = staff.userId;
    }
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  const XLSX =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /** Every export, with the role that may take it and the query it needs. */
  const EXPORTS: { path: string; role: StaffRole; query?: string }[] = [
    { path: '/api/exports/reports/line-wise', role: 'ADMIN' },
    { path: '/api/exports/reports/investment', role: 'ADMIN' },
    { path: '/api/exports/reports/collection', role: 'ADMIN' },
    { path: '/api/exports/reports/overdue', role: 'ADMIN' },
    { path: '/api/exports/reports/discrepancy', role: 'ADMIN' },
    {
      path: '/api/exports/collections',
      role: 'ADMIN',
      query: `from=${startOfMonth(today)}&to=${today}`,
    },
    { path: '/api/exports/dashboards/overview', role: 'SUPER_ADMIN' },
    { path: '/api/exports/dashboards/operations', role: 'ADMIN' },
    { path: '/api/exports/dashboards/sectors', role: 'ADMIN' },
    { path: '/api/exports/dashboards/line', role: 'SENIOR' },
  ];

  it.each(EXPORTS)(
    '$path answers an Excel and a PDF attachment, and records each as an EXPORT',
    async ({ path, role, query }) => {
      for (const format of ['xlsx', 'pdf'] as const) {
        const before = recordedAudit.length;
        const response = await download(
          role,
          `${path}?format=${format}${query ? `&${query}` : ''}`,
        ).expect(200);
        expect(response.headers['content-type']).toBe(
          format === 'xlsx' ? XLSX : 'application/pdf',
        );
        expect(response.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="rasi-[A-Za-z0-9.-]+\\.${format}"$`,
          ),
        );
        const bytes = response.body as Buffer;
        // A workbook is a zip; a PDF says so in its first bytes.
        expect(
          bytes.subarray(0, format === 'xlsx' ? 2 : 5).toString('latin1'),
        ).toBe(format === 'xlsx' ? 'PK' : '%PDF-');

        const entries = recordedAudit.slice(before);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          actorUserId: userIds[role],
          action: 'EXPORT',
          entityTable: 'export',
          entityId: path.replace('/api/exports/', ''),
          after: { format, rows: expect.any(Number) },
        });
      }
    },
  );

  it('puts the same lines in the workbook as the report the screen reads', async () => {
    const report = await request(app.getHttpServer())
      .get('/api/reports/line-wise')
      .set('Cookie', cookies.ADMIN)
      .expect(200);
    const response = await download(
      'ADMIN',
      '/api/exports/reports/line-wise?format=xlsx',
    ).expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body as ArrayBuffer);
    const sheet = book.getWorksheet('Lines')!;
    const codes: unknown[] = [];
    sheet.eachRow((row) => codes.push(row.getCell(1).value));
    for (const line of report.body.lines as { code: string }[]) {
      expect(codes).toContain(line.code);
    }
    expect(codes).toContain('Total');
  });

  it('a Senior exports their own line; another line or sector is 404, and nothing is recorded', async () => {
    await download(
      'SENIOR',
      '/api/exports/reports/line-wise?format=pdf',
    ).expect(200);
    const before = recordedAudit.length;
    const otherLine = await download(
      'SENIOR',
      `/api/exports/reports/line-wise?format=xlsx&lineId=${other.id}`,
    ).expect(404);
    expect(json(otherLine.body as Buffer).code).toBe('LINE_NOT_FOUND');
    const elsewhere = await download(
      'SENIOR',
      `/api/exports/reports/overdue?format=xlsx&sectorId=${otherSector.id}`,
    ).expect(404);
    expect(json(elsewhere.body as Buffer).code).toBe('SECTOR_NOT_FOUND');
    const line = await download(
      'SENIOR',
      `/api/exports/dashboards/line?format=pdf&lineId=${other.id}`,
    ).expect(404);
    expect(json(line.body as Buffer).code).toBe('LINE_NOT_FOUND');
    expect(recordedAudit.slice(before)).toHaveLength(0);
  });

  it('a Junior may not export a report or a dashboard (403); no session is 401', async () => {
    const report = await download(
      'JUNIOR',
      '/api/exports/reports/line-wise?format=xlsx',
    ).expect(403);
    expect(json(report.body as Buffer).code).toBe('PERMISSION_DENIED');
    await download('JUNIOR', '/api/exports/dashboards/line?format=pdf').expect(
      403,
    );
    await download(
      'SENIOR',
      '/api/exports/dashboards/sectors?format=pdf',
    ).expect(403);
    const anonymous = await download(
      null,
      '/api/exports/reports/line-wise?format=xlsx',
    ).expect(401);
    expect(json(anonymous.body as Buffer).code).toBe('UNAUTHENTICATED');
  });

  it('downloads the same report as CSV, headed so the file explains itself (US-087)', async () => {
    const response = await download(
      'ADMIN',
      '/api/exports/reports/line-wise?format=csv',
    ).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('.csv"');
    const text = (response.body as Buffer).toString('utf8');
    // The byte-order mark keeps rupee signs and Tamil names intact in Excel.
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('Line-wise report');
    expect(text).toContain('Period');
  });

  it('refuses a missing or unknown format, and a view’s own bad input, with its JSON error', async () => {
    const missing = await download(
      'ADMIN',
      '/api/exports/reports/line-wise',
    ).expect(400);
    expect(json(missing.body as Buffer).code).toBe('VALIDATION_FAILED');
    // csv joined xlsx and pdf on 2026-09-20 (US-087); this is still unknown.
    await download('ADMIN', '/api/exports/reports/line-wise?format=doc').expect(
      400,
    );
    // S-16's own rule: the list needs its dates.
    await download('ADMIN', '/api/exports/collections?format=xlsx').expect(400);
    const future = await download(
      'ADMIN',
      '/api/exports/dashboards/overview?format=pdf&date=2999-01-01',
    );
    expect(future.status).toBe(422);
  });
});
