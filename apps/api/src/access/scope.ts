import type { Prisma } from '@repo/db';

import { NotFoundError } from '../platform/errors/errors.js';
import type { RequestContext } from '../platform/context/request-context.js';

/**
 * Data scoping — the row half of the RBAC matrix (M02).
 *
 * | Role          | Rows                                                  |
 * | ------------- | ----------------------------------------------------- |
 * | `SUPER_ADMIN` | everything in their organization                      |
 * | `ADMIN`       | everything in their organization                      |
 * | `SENIOR`      | `lineId = current assignment`                         |
 * | `JUNIOR`      | `lineId = current assignment` (see `juniorCustomers`) |
 *
 * Admins are bounded by `organizationId`, so "all" never means rows belonging
 * to another business in the same database.
 *
 * **Historical rows scope by their own attribution** — `collection.lineId`,
 * frozen at write (BR-15) — so a Senior moved from Line 3 to Line 7 sees Line
 * 7's collections from before the move and none of Line 3's.
 *
 * A Senior or Junior with no current assignment matches **no rows**, not all
 * of them: the predicate becomes an impossible condition, and lookups return
 * `404`.
 *
 * Every predicate is combined with the query's own filter through `inScope`,
 * so a repository cannot express "these rows" without also saying "for whom".
 */

/** Matches nothing. Prisma treats `in: []` as always false. */
const NO_ROWS = { id: { in: [] as string[] } };

function seesEverything(context: RequestContext): boolean {
  return context.role === 'SUPER_ADMIN' || context.role === 'ADMIN';
}

/** Sectors in the organization, or the sector of the caller's current line. */
export function sectorScope(context: RequestContext): Prisma.SectorWhereInput {
  if (seesEverything(context))
    return { organizationId: context.organizationId };
  if (context.currentLineId === null) return NO_ROWS;
  return { lines: { some: { id: context.currentLineId } } };
}

/** Lines in the organization, or the caller's current line — "own line". */
export function lineScope(context: RequestContext): Prisma.LineWhereInput {
  if (seesEverything(context))
    return { organizationId: context.organizationId };
  if (context.currentLineId === null) return NO_ROWS;
  return { id: context.currentLineId };
}

/** Customers on the caller's current line, or all in the organization for Admins. */
export function customerScope(
  context: RequestContext,
): Prisma.CustomerWhereInput {
  if (seesEverything(context))
    return { organizationId: context.organizationId };
  if (context.currentLineId === null) return NO_ROWS;
  if (context.role === 'JUNIOR') return juniorCustomers(context.currentLineId);
  return { lineId: context.currentLineId };
}

/**
 * The single definition of "customers assigned to this Junior".
 *
 * **Decided 2026-09-13: every customer on the Junior's current line.** The
 * data model has no customer-to-Junior assignment, and a line is not known to
 * have more than one Junior at a time. If per-Junior assignment is added (a
 * temporal `customer_assignment` table), this function changes and nothing
 * that calls it does. Recorded as an open question in the RBAC matrix.
 */
function juniorCustomers(lineId: string): Prisma.CustomerWhereInput {
  return { lineId };
}

/**
 * Collections by their frozen `lineId`. A Junior sees only their own entries
 * (`collectedByUserId`) on their current line — "own entries" in the matrix.
 */
export function collectionScope(
  context: RequestContext,
): Prisma.CollectionWhereInput {
  if (seesEverything(context)) {
    return { line: { organizationId: context.organizationId } };
  }
  if (context.currentLineId === null) return NO_ROWS;
  if (context.role === 'JUNIOR') {
    return {
      lineId: context.currentLineId,
      collectedByUserId: context.userId,
    };
  }
  return { lineId: context.currentLineId };
}

/** Combines a scope predicate with a query's own filter. Both must hold. */
export function inScope<Where extends object>(
  scope: Where,
  where?: Where,
): { AND: Where[] } {
  return { AND: where ? [scope, where] : [scope] };
}

/**
 * Returns the row, or throws `NotFoundError` — for a row that does not exist
 * **and** for one outside the caller's scope, with an identical response, so
 * probing ids reveals nothing (M02 failure semantics).
 */
export function foundInScope<Row>(
  row: Row | null | undefined,
  entity: string,
): Row {
  if (row === null || row === undefined) {
    throw new NotFoundError(
      `${entity.toUpperCase()}_NOT_FOUND`,
      `${entity[0]?.toUpperCase()}${entity.slice(1)} not found`,
    );
  }
  return row;
}
