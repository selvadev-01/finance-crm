import { Injectable } from '@nestjs/common';
import type {
  RouteInput,
  SecurityEvent,
  securityContract,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  businessDayStart,
  parseCalendarDate,
} from '@repo/domain';

import { userNames } from '../audit/audit-log.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ValidationError } from '../platform/errors/errors.js';
import {
  decodeCursor,
  encodeCursor,
  type Page,
} from '../platform/pagination.js';

type ListQuery = RouteInput<
  typeof securityContract.listSecurityEvents
>['query'];

const rowSelect = {
  id: true,
  createdAt: true,
  kind: true,
  code: true,
  status: true,
  method: true,
  path: true,
  actorUserId: true,
  actorRole: true,
  targetTable: true,
  targetId: true,
  detail: true,
  ipAddress: true,
  userAgent: true,
} satisfies Prisma.SecurityEventSelect;

type SecurityEventRowView = Prisma.SecurityEventGetPayload<{
  select: typeof rowSelect;
}>;

/**
 * The security log (ADR-0014) — the organization's refused attempts, newest first, read-only.
 *
 * Scoped by the `organizationId` every row records, like the audit log: a
 * refusal is only ever written for a caller whose context was already resolved,
 * so every row belongs to exactly one business.
 */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly database: Database) {}

  async list(
    context: RequestContext,
    query: ListQuery,
  ): Promise<Page<SecurityEvent>> {
    const tx = this.database.client;
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from)
      createdAt.gte = businessDayStart(parseCalendarDate(query.from));
    if (query.to)
      createdAt.lt = businessDayStart(
        addCalendarDays(parseCalendarDate(query.to), 1),
      );
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError(
        'INVALID_DATE_RANGE',
        '"from" must be on or before "to"',
        [{ field: 'from', issue: 'is after "to"' }],
      );
    }

    // Newest first; (createdAt, id) is a total order, so a page never repeats
    // or skips a row.
    const rows = await tx.securityEvent.findMany({
      where: {
        organizationId: context.organizationId,
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.code ? { code: query.code } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
      },
      select: rowSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor
        ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }
        : {}),
    });
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const names = await userNames(
      tx,
      visible.map((row) => row.actorUserId),
    );
    return {
      data: visible.map((row) => toSecurityEvent(row, names)),
      nextCursor:
        hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
      hasMore,
    };
  }
}

export function toSecurityEvent(
  row: SecurityEventRowView,
  names: Map<string, string>,
): SecurityEvent {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    kind: row.kind,
    code: row.code,
    status: row.status,
    method: row.method,
    path: row.path,
    actor: {
      userId: row.actorUserId,
      // A staff member deleted since keeps their attempts; there is no
      // foreign key, so the name may simply be gone.
      name: names.get(row.actorUserId) ?? 'Unknown user',
      role: row.actorRole,
    },
    targetTable: row.targetTable,
    targetId: row.targetId,
    detail:
      row.detail !== null &&
      typeof row.detail === 'object' &&
      !Array.isArray(row.detail)
        ? row.detail
        : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}
