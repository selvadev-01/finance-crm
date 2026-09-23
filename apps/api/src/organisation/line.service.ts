import { Injectable } from '@nestjs/common';
import type { Line } from '@repo/contracts';

import {
  foundInScope,
  inScope,
  lineScope,
  sectorScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';
import {
  type Page,
  type PageRequest,
  pageArgs,
  toPage,
} from '../platform/pagination.js';
import {
  CODE_ATTEMPTS,
  issuedCodes,
  LINE_CODE_PREFIX,
  nextCode,
} from './codes.js';
import { isUniqueViolation } from './prisma-errors.js';

const lineFields = {
  id: true,
  sectorId: true,
  code: true,
  name: true,
  isActive: true,
} as const;

/** Lines (M03, US-011). Every method takes the caller's context (M02). */
@Injectable()
export class LineService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    context: RequestContext,
    page: PageRequest & {
      includeInactive: boolean;
      sectorId?: string | undefined;
    },
  ): Promise<Page<Line>> {
    // One `where` for both reads, so the total is scoped exactly as the rows are.
    const where = inScope(lineScope(context), {
      ...(page.includeInactive ? {} : { isActive: true }),
      ...(page.sectorId ? { sectorId: page.sectorId } : {}),
    });
    const [rows, total] = await Promise.all([
      this.database.client.line.findMany({
        where,
        select: lineFields,
        ...pageArgs(page),
      }),
      this.database.client.line.count({ where }),
    ]);
    return toPage(rows, page, (row) => row, total);
  }

  /** One line in scope, active or not; out of scope is `404` (M02). */
  get(context: RequestContext, lineId: string): Promise<Line> {
    return this.getInScope(context, lineId);
  }

  /**
   * US-011: a line belongs to an active sector the caller can see. Its code is
   * issued, not typed — `LIN-00001` upward within the organization, settled by
   * the unique index and retried when two Admins pick the same number at once
   * (see `SectorService.create`).
   */
  async create(
    context: RequestContext,
    input: { sectorId: string; name: string },
  ): Promise<Line> {
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.createOnce(context, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ConflictError(
      'LINE_CODE_TAKEN',
      'Another line took the next code. Try again.',
    );
  }

  private createOnce(
    context: RequestContext,
    input: { sectorId: string; name: string },
  ): Promise<Line> {
    return this.database.transaction(async (tx) => {
      const sector = foundInScope(
        await tx.sector.findFirst({
          where: inScope(sectorScope(context), { id: input.sectorId }),
          select: { id: true, isActive: true },
        }),
        'sector',
      );
      if (!sector.isActive) {
        throw new DomainError(
          'SECTOR_INACTIVE',
          'Lines cannot be added to an inactive sector',
          [{ field: 'sectorId', issue: 'is inactive' }],
        );
      }

      const used = await tx.line.findMany({
        where: {
          organizationId: context.organizationId,
          code: issuedCodes(LINE_CODE_PREFIX),
        },
        select: { code: true },
      });
      const line = await tx.line.create({
        data: {
          organizationId: context.organizationId,
          sectorId: sector.id,
          code: nextCode(LINE_CODE_PREFIX, used),
          name: input.name,
          createdByUserId: context.userId,
        },
        select: lineFields,
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'line',
        entityId: line.id,
        after: { code: line.code, name: line.name, sectorId: line.sectorId },
      });
      return line;
    });
  }

  rename(context: RequestContext, lineId: string, name: string): Promise<Line> {
    return this.database.transaction(async (tx) => {
      const current = await this.getInScope(context, lineId);
      const line = await tx.line.update({
        where: { id: current.id },
        data: { name },
        select: lineFields,
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'line',
        entityId: line.id,
        before: { name: current.name },
        after: { name: line.name },
      });
      return line;
    });
  }

  /**
   * US-011: a line with ACTIVE accounts cannot be deactivated — its customers
   * are still being collected from. Service-enforced: it needs a count
   * (data-dictionary.md).
   */
  deactivate(context: RequestContext, lineId: string): Promise<Line> {
    return this.database.transaction(async (tx) => {
      const current = await this.getInScope(context, lineId);
      if (!current.isActive) return current;

      const activeAccounts = await tx.accountLoan.count({
        where: { lineId: current.id, status: 'ACTIVE' },
      });
      if (activeAccounts > 0) {
        throw new DomainError(
          'LINE_HAS_ACTIVE_ACCOUNTS',
          `This line has ${activeAccounts} active account${activeAccounts === 1 ? '' : 's'}.`,
        );
      }
      const line = await tx.line.update({
        where: { id: current.id },
        data: { isActive: false },
        select: lineFields,
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'line',
        entityId: line.id,
        before: { isActive: true },
        after: { isActive: false },
      });
      return line;
    });
  }

  private async getInScope(context: RequestContext, lineId: string) {
    const line = await this.database.client.line.findFirst({
      where: inScope(lineScope(context), { id: lineId }),
      select: lineFields,
    });
    return foundInScope(line, 'line');
  }
}
