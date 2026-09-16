import { Injectable } from '@nestjs/common';
import type { AuditAction, Prisma } from '@repo/db';

import {
  getRequestClient,
  type RequestContext,
} from '../platform/context/request-context.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';
import { InternalError } from '../platform/errors/errors.js';

export interface AuditEntry {
  action: AuditAction;
  entityTable: string;
  entityId: string;
  /** Snapshots of the fields that changed — never credentials (M13). */
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
}

export type AuditRow = Prisma.AuditLogUncheckedCreateInput;

/**
 * Writes `audit_log` entries (M13).
 *
 * **Only inside a transaction**, which it refuses otherwise: the entry must
 * commit or roll back with the change it describes, or an action could commit
 * unaudited. Called from a service's `Database.transaction`, `Database.client`
 * is that transaction.
 *
 * Every entry names its organization, so the log is read in scope (US-090).
 * Services call it directly inside their own transaction (decided 2026-09-15:
 * no event bus); `test/audit-coverage.e2e-spec.ts` holds each audited write
 * path to recording an entry.
 */
@Injectable()
export class AuditWriter {
  constructor(protected readonly database: Database) {}

  async record(context: RequestContext, entry: AuditEntry): Promise<void> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'AUDIT_OUTSIDE_TRANSACTION',
        `Audit entry for ${entry.entityTable} written outside a transaction`,
      );
    }
    const client = getRequestClient();
    await this.write({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      entityTable: entry.entityTable,
      entityId: entry.entityId,
      action: entry.action,
      ...(entry.before ? { before: entry.before } : {}),
      ...(entry.after ? { after: entry.after } : {}),
      ipAddress: client?.ipAddress ?? null,
      userAgent: client?.userAgent ?? null,
    });
  }

  /**
   * A system action — a scheduled job (M14). Null actor, as M13 specifies;
   * the job's run id goes in `after.systemRun`. Same transaction rule.
   */
  async recordSystem(system: SystemContext, entry: AuditEntry): Promise<void> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'AUDIT_OUTSIDE_TRANSACTION',
        `Audit entry for ${entry.entityTable} written outside a transaction`,
      );
    }
    await this.write({
      organizationId: system.organizationId,
      actorUserId: null,
      entityTable: entry.entityTable,
      entityId: entry.entityId,
      action: entry.action,
      ...(entry.before ? { before: entry.before } : {}),
      after: { ...entry.after, systemRun: system.runId },
      ipAddress: null,
      userAgent: null,
    });
  }

  /** The insert itself. HTTP tests replace it: `audit_log` rejects DELETE. */
  protected async write(row: AuditRow): Promise<void> {
    await this.database.client.auditLog.create({ data: row });
  }
}
