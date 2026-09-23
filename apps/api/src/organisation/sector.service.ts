import { Injectable } from '@nestjs/common';
import type { Sector } from '@repo/contracts';

import { foundInScope, inScope, sectorScope } from '../access/scope.js';
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
  nextCode,
  SECTOR_CODE_PREFIX,
} from './codes.js';
import { isUniqueViolation } from './prisma-errors.js';

const sectorFields = {
  id: true,
  code: true,
  name: true,
  isActive: true,
} as const;

/** Sectors (M03, US-010). Every method takes the caller's context (M02). */
@Injectable()
export class SectorService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    context: RequestContext,
    page: PageRequest & { includeInactive: boolean },
  ): Promise<Page<Sector>> {
    // One `where` for both reads, so the total is scoped exactly as the rows are.
    const where = inScope(
      sectorScope(context),
      page.includeInactive ? {} : { isActive: true },
    );
    const [rows, total] = await Promise.all([
      this.database.client.sector.findMany({
        where,
        select: sectorFields,
        ...pageArgs(page),
      }),
      this.database.client.sector.count({ where }),
    ]);
    return toPage(rows, page, (row) => row, total);
  }

  /** One sector in scope, active or not; out of scope is `404` (M02). */
  get(context: RequestContext, sectorId: string): Promise<Sector> {
    return this.getInScope(context, sectorId);
  }

  /**
   * US-010. The code is issued, not typed: `SEC-00001` upward within the
   * organization. Two Admins creating at the same moment can read the same
   * highest code and pick the same number; the per-organization unique index
   * settles it and the loser retries. The retry is around the transaction, not
   * inside it — a unique violation aborts the PostgreSQL transaction, so
   * nothing more can be done within it.
   */
  async create(
    context: RequestContext,
    input: { name: string },
  ): Promise<Sector> {
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt += 1) {
      try {
        return await this.createOnce(context, input.name);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ConflictError(
      'SECTOR_CODE_TAKEN',
      'Another sector took the next code. Try again.',
    );
  }

  private createOnce(context: RequestContext, name: string): Promise<Sector> {
    return this.database.transaction(async (tx) => {
      const used = await tx.sector.findMany({
        where: {
          organizationId: context.organizationId,
          code: issuedCodes(SECTOR_CODE_PREFIX),
        },
        select: { code: true },
      });
      const sector = await tx.sector.create({
        data: {
          organizationId: context.organizationId,
          code: nextCode(SECTOR_CODE_PREFIX, used),
          name,
          createdByUserId: context.userId,
        },
        select: sectorFields,
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'sector',
        entityId: sector.id,
        after: { code: sector.code, name: sector.name },
      });
      return sector;
    });
  }

  rename(
    context: RequestContext,
    sectorId: string,
    name: string,
  ): Promise<Sector> {
    return this.database.transaction(async (tx) => {
      const current = await this.getInScope(context, sectorId);
      const sector = await tx.sector.update({
        where: { id: current.id },
        data: { name },
        select: sectorFields,
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'sector',
        entityId: sector.id,
        before: { name: current.name },
        after: { name: sector.name },
      });
      return sector;
    });
  }

  /** US-010: a sector with active lines cannot be deactivated. */
  deactivate(context: RequestContext, sectorId: string): Promise<Sector> {
    return this.database.transaction(async (tx) => {
      const current = await this.getInScope(context, sectorId);
      if (!current.isActive) return current;

      const activeLines = await tx.line.count({
        where: { sectorId: current.id, isActive: true },
      });
      if (activeLines > 0) {
        throw new DomainError(
          'SECTOR_HAS_ACTIVE_LINES',
          `This sector has ${activeLines} active line${activeLines === 1 ? '' : 's'}. Deactivate them first.`,
        );
      }
      const sector = await tx.sector.update({
        where: { id: current.id },
        data: { isActive: false },
        select: sectorFields,
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'sector',
        entityId: sector.id,
        before: { isActive: true },
        after: { isActive: false },
      });
      return sector;
    });
  }

  private async getInScope(context: RequestContext, sectorId: string) {
    const sector = await this.database.client.sector.findFirst({
      where: inScope(sectorScope(context), { id: sectorId }),
      select: sectorFields,
    });
    return foundInScope(sector, 'sector');
  }
}
