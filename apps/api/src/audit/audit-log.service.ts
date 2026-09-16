import { Injectable } from '@nestjs/common';
import type { AuditEntry, auditContract, RouteInput } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  businessDayStart,
  parseCalendarDate,
} from '@repo/domain';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ValidationError } from '../platform/errors/errors.js';
import {
  decodeCursor,
  encodeCursor,
  type Page,
} from '../platform/pagination.js';

type ListQuery = RouteInput<typeof auditContract.listAuditLog>['query'];

export const auditRowSelect = {
  id: true,
  createdAt: true,
  action: true,
  entityTable: true,
  entityId: true,
  actorUserId: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
} satisfies Prisma.AuditLogSelect;

export type AuditRowView = Prisma.AuditLogGetPayload<{
  select: typeof auditRowSelect;
}>;

/**
 * US-090 — the organization's audit log, read-only, newest first. Rows are
 * scoped by the `organizationId` each entry records; entries written before
 * that column existed, and sign-in attempts with an unknown email, belong to
 * no organization and are not listed.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly database: Database) {}

  async list(
    context: RequestContext,
    query: ListQuery,
  ): Promise<Page<AuditEntry>> {
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

    // Newest first. The cursor is the last row's id; (createdAt, id) is a
    // total order, so a page never repeats or skips a row.
    const rows = await tx.auditLog.findMany({
      where: {
        organizationId: context.organizationId,
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.entityTable ? { entityTable: query.entityTable } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
      },
      select: auditRowSelect,
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
      data: visible.map((row) => toAuditEntry(row, names)),
      nextCursor:
        hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
      hasMore,
    };
  }
}

/** Display names for the given user ids, one query. */
export async function userNames(
  tx: Prisma.TransactionClient,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

export function person(names: Map<string, string>, userId: string) {
  return { userId, name: names.get(userId) ?? 'Unknown user' };
}

export function toAuditEntry(
  row: AuditRowView,
  names: Map<string, string>,
): AuditEntry {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    entityTable: row.entityTable,
    entityId: row.entityId,
    actor: row.actorUserId ? person(names, row.actorUserId) : null,
    // A null actor on anything but a sign-in is a job or an automatic change (M13).
    system: row.actorUserId === null && row.action !== 'LOGIN',
    before: snapshot(row.before),
    after: snapshot(row.after),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

function snapshot(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}
