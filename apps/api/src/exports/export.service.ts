import { Injectable, StreamableFile } from '@nestjs/common';
import { EXPORT_ROW_LIMIT, type ExportFormat } from '@repo/contracts';
import type { Prisma } from '@repo/db';

import { AuditWriter } from '../audit/audit.writer.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import {
  CONTENT_TYPE,
  type ExportDocument,
  type RenderedExport,
  rowCount,
} from './export-document.js';
import { renderCsv } from './csv-renderer.js';
import { renderPdf } from './pdf-renderer.js';
import { renderXlsx } from './xlsx-renderer.js';

/** What was exported, as the audit entry names it: `reports/line-wise`. */
export type ExportName =
  | 'reports/line-wise'
  | 'reports/investment'
  | 'reports/collection'
  | 'reports/overdue'
  | 'reports/discrepancy'
  | 'collections'
  | 'dashboards/overview'
  | 'dashboards/operations'
  | 'dashboards/sectors'
  | 'dashboards/line';

export interface ExportRequest {
  name: ExportName;
  format: ExportFormat;
  /**
   * The filters as the caller sent them, for the audit entry — ids, dates and
   * enums only, never a name (M13's no-personal-data rule for snapshots).
   */
  filters: Record<string, string | number | undefined>;
}

/**
 * Turns a view's document into a file and records that it left the system
 * (M12, M13). The view itself was read by the caller, through the same
 * service and scope as the screen.
 *
 * Order matters: the file is rendered **before** the audit entry is written,
 * so a file that fails to render leaves no entry claiming it was taken, and
 * the entry commits before a byte is sent, so no file leaves unrecorded.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  async deliver(
    context: RequestContext,
    request: ExportRequest,
    document: ExportDocument,
  ): Promise<StreamableFile> {
    const rows = rowCount(document);
    assertWithinLimit(rows);
    const file = await this.render(request.format, document);

    await this.database.transaction(() =>
      this.audit.record(context, {
        action: 'EXPORT',
        entityTable: 'export',
        entityId: request.name,
        after: {
          format: request.format,
          filters: definedOnly(request.filters),
          rows,
          filename: file.filename,
        },
      }),
    );

    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
      length: file.bytes.length,
    });
  }

  async render(
    format: ExportFormat,
    document: ExportDocument,
  ): Promise<RenderedExport> {
    const bytes =
      format === 'xlsx'
        ? await renderXlsx(document)
        : format === 'csv'
          ? renderCsv(document)
          : await renderPdf(document);
    return {
      bytes,
      filename: `${safeFilename(document.filename)}.${format}`,
      contentType: CONTENT_TYPE[format],
    };
  }
}

/**
 * Reads a paged view to its end for an export (overdue, discrepancy, the
 * collection list): the first page carries the summary, the rest only rows.
 * Stops — and refuses — as soon as the rows pass {@link EXPORT_ROW_LIMIT},
 * rather than reading a million rows to say no.
 */
export async function readAllPages<
  Page extends { data: unknown[]; nextCursor: string | null; hasMore: boolean },
>(
  read: (cursor: string | undefined) => Promise<Page>,
): Promise<{ first: Page; rows: Page['data'] }> {
  const first = await read(undefined);
  const rows = [...first.data];
  let page: Page = first;
  while (page.hasMore && page.nextCursor !== null) {
    assertWithinLimit(rows.length);
    page = await read(page.nextCursor);
    rows.push(...page.data);
  }
  assertWithinLimit(rows.length);
  return { first, rows };
}

/** The page size an export reads with: the largest the views accept. */
export const EXPORT_PAGE_SIZE = 200;

function assertWithinLimit(rows: number): void {
  if (rows > EXPORT_ROW_LIMIT) {
    throw new DomainError(
      'EXPORT_TOO_LARGE',
      `This export would have more than ${EXPORT_ROW_LIMIT.toLocaleString('en-IN')} rows. Narrow the dates or filters and try again.`,
    );
  }
}

function definedOnly(
  filters: ExportRequest['filters'],
): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as Prisma.InputJsonObject;
}

/** Letters, digits, dots and hyphens: safe in a header and on every disk. */
function safeFilename(name: string): string {
  return name
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}
