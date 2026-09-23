import { ValidationError } from './errors/errors.js';

/**
 * Cursor pagination (api-design.md#pagination). The cursor is the last row's
 * id, opaque to clients; rows are ordered by id, which is stable under
 * concurrent inserts.
 */
export interface PageRequest {
  cursor?: string | undefined;
  limit: number;
}

export interface Page<Item> {
  data: Item[];
  nextCursor: string | null;
  hasMore: boolean;
  /**
   * How many rows the filter matches in total. The rows are still walked by
   * cursor — this only tells the reader where they are ("51–100 of 1,234")
   * and how many pages there are. It is counted with the same `where` as the
   * page itself, so it is scoped exactly as the rows are (M02).
   */
  total: number;
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!id || encodeCursor(id) !== cursor) {
    throw new ValidationError(
      'INVALID_CURSOR',
      'The page cursor is not valid',
      [{ field: 'cursor', issue: 'is not a cursor this API issued' }],
    );
  }
  return id;
}

/** Prisma arguments for one page: one extra row tells whether more exist. */
export function pageArgs(page: PageRequest) {
  return {
    take: page.limit + 1,
    orderBy: { id: 'asc' as const },
    ...(page.cursor
      ? { cursor: { id: decodeCursor(page.cursor) }, skip: 1 }
      : {}),
  };
}

export function toPage<Row extends { id: string }, Item>(
  rows: Row[],
  page: PageRequest,
  toItem: (row: Row) => Item,
  total: number,
): Page<Item> {
  return toPageBy(rows, page, (row) => row.id, toItem, total);
}

/**
 * {@link toPage} for a list ordered by something other than the id — the
 * overdue report is by target completion date or by outstanding (US-087), so
 * its cursor carries that value **and** the id, and the row's own key function
 * is what encodes it. The id is always the last part, so the order is total
 * and a page boundary can never repeat or drop a row.
 */
export function toPageBy<Row, Item>(
  rows: Row[],
  page: PageRequest,
  key: (row: Row) => string,
  toItem: (row: Row) => Item,
  total: number,
): Page<Item> {
  const hasMore = rows.length > page.limit;
  const visible = hasMore ? rows.slice(0, page.limit) : rows;
  const last = visible.at(-1);
  return {
    data: visible.map(toItem),
    nextCursor: hasMore && last !== undefined ? encodeCursor(key(last)) : null,
    hasMore,
    total,
  };
}
