import type { Prisma } from '@repo/db';
import type { CalendarDate } from '@repo/domain';

import {
  foundInScope,
  inScope,
  lineScope,
  sectorScope,
  staffScope,
} from '../access/scope.js';
import type { Tx } from '../dashboards/business-figures.js';
import type { RequestContext } from '../platform/context/request-context.js';

/** The sector and line filter every line-shaped report takes (M12). */
export interface ReportFilters {
  sectorId?: string;
  lineId?: string;
}

/**
 * Scope before filters (M02): a filter naming a sector or line the caller
 * cannot see — another Senior's line, another organization's — is `404`,
 * identical to one that does not exist, so ids cannot be probed.
 */
export async function refuseOutOfScopeFilters(
  tx: Tx,
  context: RequestContext,
  filters: ReportFilters,
): Promise<void> {
  if (filters.sectorId !== undefined) {
    foundInScope(
      await tx.sector.findFirst({
        where: inScope(sectorScope(context), { id: filters.sectorId }),
        select: { id: true },
      }),
      'sector',
    );
  }
  if (filters.lineId !== undefined) {
    foundInScope(
      await tx.line.findFirst({
        where: inScope(lineScope(context), { id: filters.lineId }),
        select: { id: true },
      }),
      'line',
    );
  }
}

/**
 * Scope before filters, for a report that narrows by collector (US-086): a
 * staff member the caller cannot see — another line's Junior for a Senior,
 * another organization's, a deleted one — is `404`, as a missing one is.
 * "Visible" is `staffScope` on today's business date, the same rule the staff
 * directory uses.
 */
export async function refuseOutOfScopeCollector(
  tx: Tx,
  context: RequestContext,
  collectedByUserId: string | undefined,
  today: CalendarDate,
): Promise<void> {
  if (collectedByUserId === undefined) return;
  foundInScope(
    await tx.staffProfile.findFirst({
      where: inScope(staffScope(context, today), {
        userId: collectedByUserId,
      }),
      select: { id: true },
    }),
    'staff',
  );
}

/**
 * The lines a report lists: those in the caller's scope, narrowed by the
 * filters it was given. A Senior's "every line" is their own line.
 */
export function reportLineWhere(
  context: RequestContext,
  filters: ReportFilters,
): Prisma.LineWhereInput {
  return inScope(lineScope(context), {
    ...(filters.sectorId === undefined ? {} : { sectorId: filters.sectorId }),
    ...(filters.lineId === undefined ? {} : { id: filters.lineId }),
  });
}
