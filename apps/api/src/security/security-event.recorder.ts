import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@repo/db';
import { PinoLogger } from 'nestjs-pino';

import {
  getRequestClient,
  getRequestRoute,
  type RequestContext,
  type RequestRoute,
} from '../platform/context/request-context.js';
import { PRISMA_CLIENT } from '../platform/database/database.js';
import { classifyRefusal } from './security-refusals.js';

export type SecurityEventRow = Prisma.SecurityEventUncheckedCreateInput;

/** What the attempt was aimed at, and the few curated facts worth keeping. */
export interface RefusalTarget {
  /** Overrides the table the registry gives the code. */
  table?: string;
  id?: string | null;
  /**
   * Curated facts only — an attempted role, the permission that was missing.
   * **Never a request body**, and never a value `SAFE_LOG_KEYS` would redact:
   * no names, no email addresses, no phone numbers, no credentials (M13).
   */
  detail?: Prisma.InputJsonObject;
}

/**
 * Writes `security_event` rows: the security-relevant attempts the API refused
 * (M13, ADR-0014).
 *
 * Three properties carry the whole design, and each is enforced here rather
 * than remembered at the call sites:
 *
 * 1. **It never changes the request it observes.** `refused` swallows its own
 *    failures — a database that will not take the row is logged at `error` and
 *    the original refusal reaches the client unaltered. Callers rethrow the
 *    error they caught; nothing here wraps, replaces or resolves it.
 * 2. **It writes on the base client, outside any transaction.** The opposite of
 *    `AuditWriter`, and for the opposite reason: an audit entry must roll back
 *    with the change it describes, while a refusal has no change to share a
 *    fate with — and the transaction it was thrown inside is about to roll back
 *    and would take the record with it. Callers therefore invoke this **after**
 *    their transaction has unwound, never inside it.
 * 3. **Only classified codes are kept.** `refused` is safe to wrap a whole
 *    method with: anything `security-refusals.ts` does not name — a validation
 *    error, a conflict, an infrastructure failure — passes through unrecorded.
 *
 * HTTP tests replace `write`, exactly as they do for `AuditWriter`, so the RBAC
 * matrix suite does not write hundreds of rows per run into the shared
 * development schema; Tier 1 proves the real rows inside a rolled-back
 * transaction.
 */
@Injectable()
export class SecurityEventRecorder {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly base: PrismaClient,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Record `error` if it is a refusal worth keeping. Returns normally whatever
   * happens; the caller rethrows the original error.
   */
  async refused(
    context: RequestContext,
    error: unknown,
    target: RefusalTarget = {},
  ): Promise<void> {
    const refusal = classifyRefusal(error);
    if (!refusal) return;

    try {
      const route = this.route();
      if (!route) {
        // No matched route means no request — a job, or a service called
        // directly. There is nothing to attribute the attempt to, so the row
        // would be unreadable. Visible, not fatal.
        this.logger.warn(
          { code: refusal.code },
          'security event not recorded: no route in context',
        );
        return;
      }
      const client = getRequestClient();
      const id = target.id ?? null;
      const table =
        id === null ? null : (target.table ?? refusal.targetTable ?? null);
      await this.write({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        actorRole: context.role,
        kind: refusal.kind,
        code: refusal.code,
        status: refusal.status,
        method: route.method,
        path: route.path,
        // A table with nothing to point at says nothing, so it goes only with
        // an id (security_event_target_table_needs_id_check).
        targetTable: table,
        targetId: id,
        ...(target.detail ? { detail: target.detail } : {}),
        ipAddress: client?.ipAddress ?? null,
        userAgent: client?.userAgent ?? null,
      });
    } catch (failure) {
      // Never rethrown: the refusal the caller is reporting is the answer the
      // client must get, and losing the record must not turn a 403 into a 500.
      this.logger.error(
        { err: failure, code: refusal.code },
        'security event could not be recorded',
      );
    }
  }

  /** The route the request matched, or `undefined` outside one. */
  protected route(): RequestRoute | undefined {
    return getRequestRoute();
  }

  /** The insert itself. HTTP tests replace it — see `test/app.ts`. */
  protected async write(row: SecurityEventRow): Promise<void> {
    await this.base.securityEvent.create({ data: row });
  }
}
