import { AppError } from './errors/errors.js';
import {
  decodeCursor,
  encodeCursor,
  pageArgs,
  toPage,
  toPageBy,
} from './pagination.js';

interface Row {
  id: string;
  name: string;
}

const rows = (...ids: string[]): Row[] =>
  ids.map((id) => ({ id, name: `row ${id}` }));

const name = (row: Row) => row.name;

/**
 * Every paged endpoint goes through these two functions, so the boundaries are
 * worth pinning down: `toPage` is `toPageBy` keyed by the id, and neither may
 * hand out a cursor for a page that is already the last one.
 */
describe('toPage', () => {
  it('reads one row past the page to learn whether more exist', () => {
    // The caller takes limit + 1; the extra row is the answer, not data.
    expect(toPage(rows('a', 'b', 'c'), { limit: 2 }, name)).toEqual({
      data: ['row a', 'row b'],
      nextCursor: encodeCursor('b'),
      hasMore: true,
    });
  });

  it('ends the list when the rows exactly fill the page', () => {
    // The boundary that matters: two rows, limit two, nothing beyond. A cursor
    // here would send the client after a page that does not exist.
    expect(toPage(rows('a', 'b'), { limit: 2 }, name)).toEqual({
      data: ['row a', 'row b'],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('returns an empty page without a cursor', () => {
    expect(toPage([], { limit: 20 }, name)).toEqual({
      data: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('carries the cursor of the last visible row, not the row that peeked', () => {
    const page = toPage(rows('a', 'b', 'c', 'd'), { limit: 3 }, name);
    expect(decodeCursor(page.nextCursor!)).toBe('c');
  });
});

describe('toPageBy', () => {
  it('keys the cursor by the row, so a list ordered by anything can page', () => {
    // US-087: the overdue report orders by target date, so the cursor carries
    // that value and the id — the id last keeps the order total.
    const overdue = [
      { id: 'a', due: '2026-01-05' },
      { id: 'b', due: '2026-01-05' },
      { id: 'c', due: '2026-01-06' },
    ];
    const page = toPageBy(
      overdue,
      { limit: 2 },
      (row) => `${row.due}|${row.id}`,
      (row) => row.id,
    );
    expect(page).toEqual({
      data: ['a', 'b'],
      nextCursor: encodeCursor('2026-01-05|b'),
      hasMore: true,
    });
    // Two rows share the due date, so the id is what separates the pages.
    expect(decodeCursor(page.nextCursor!)).toBe('2026-01-05|b');
  });

  it('is what toPage is, keyed by the id', () => {
    const some = rows('a', 'b', 'c');
    expect(toPage(some, { limit: 2 }, name)).toEqual(
      toPageBy(some, { limit: 2 }, (row) => row.id, name),
    );
  });
});

describe('cursors', () => {
  it('round-trips a row key', () => {
    expect(decodeCursor(encodeCursor('a-b-c'))).toBe('a-b-c');
    expect(decodeCursor(encodeCursor('2026-01-05|9f3'))).toBe('2026-01-05|9f3');
  });

  it('refuses anything this API did not issue', () => {
    // Not base64url at all, and base64url that does not re-encode to itself:
    // both are someone editing the query string, not a page we handed out.
    for (const cursor of ['', 'not a cursor', 'YQ==']) {
      expect(() => decodeCursor(cursor)).toThrow(AppError);
      expect(() => decodeCursor(cursor)).toThrow(/not valid/);
    }
  });
});

describe('pageArgs', () => {
  it('orders by id and takes one extra row', () => {
    expect(pageArgs({ limit: 20 })).toEqual({
      take: 21,
      orderBy: { id: 'asc' },
    });
  });

  it('skips the cursor row itself, so a page never repeats it', () => {
    expect(pageArgs({ limit: 20, cursor: encodeCursor('a') })).toEqual({
      take: 21,
      orderBy: { id: 'asc' },
      cursor: { id: 'a' },
      skip: 1,
    });
  });
});
