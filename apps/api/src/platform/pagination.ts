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
): Page<Item> {
  const hasMore = rows.length > page.limit;
  const visible = hasMore ? rows.slice(0, page.limit) : rows;
  const last = visible.at(-1);
  return {
    data: visible.map(toItem),
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    hasMore,
  };
}
