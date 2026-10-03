import { Injectable } from '@nestjs/common';
import { type CalendarDate, toBusinessDate, toUtcMidnight } from '@repo/domain';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/**
 * Resolves who a signed-in user is to Rasi (M01, M02).
 *
 * Runs on every authorized request, deliberately uncached. A cache would need
 * invalidating on suspension, role change and reassignment (M02 "events
 * consumed"), and a missed invalidation is an access-control failure. One
 * indexed query per request is the cheaper way to be immediately correct.
 *
 * This query is itself unscoped by necessity — it is what scope is built from.
 */
@Injectable()
export class RequestContextResolver {
  constructor(private readonly database: Database) {}

  /**
   * `null` when the user has no staff profile, or it is soft-deleted, or its
   * status is not `ACTIVE` (M01: only `ACTIVE` may authenticate).
   *
   * `today` is the business date the assignment must be in effect on; it
   * defaults to now in Asia/Kolkata and is a parameter only so tests can pin it.
   */
  async resolve(
    userId: string,
    requestId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<RequestContext | null> {
    return (
      (await this.resolveCaller(userId, requestId, today))?.context ?? null
    );
  }

  /**
   * The context, plus whether the caller must change their password before
   * doing anything else (US-003) — which `PolicyGuard` refuses with its own
   * code, distinct from an inactive account.
   */
  async resolveCaller(
    userId: string,
    requestId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<{ context: RequestContext; mustChangePassword: boolean } | null> {
    const onToday = toUtcMidnight(today);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { userId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        organizationId: true,
        role: true,
        mustChangePassword: true,
        // The current assignments are those IN EFFECT today (decided
        // 2026-09-13), not merely those with no end date: a line added
        // "effective tomorrow" (US-013) opens its row today, and the staff
        // member's scope must not widen until tomorrow. A Senior or Junior
        // may hold several at once (decided 2026-10-03).
        assignments: {
          where: {
            effectiveFrom: { lte: onToday },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: onToday } }],
          },
          // Code order, so "their first line" — a dashboard's default — is
          // the same on every request.
          orderBy: { line: { code: 'asc' } },
          select: { lineId: true },
        },
      },
    });
    if (!staff) return null;

    return {
      context: {
        requestId,
        userId,
        staffProfileId: staff.id,
        organizationId: staff.organizationId,
        role: staff.role,
        currentLineIds: [
          ...new Set(staff.assignments.map((row) => row.lineId)),
        ],
      },
      mustChangePassword: staff.mustChangePassword,
    };
  }
}
