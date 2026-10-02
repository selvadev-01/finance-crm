/**
 * Simple Books (decided with the owner 2026-10-02): the books were too much to
 * take in, so the console shows only a money summary, expenses, this month's
 * profit, and owner drawings with other income — in everyday words, with no
 * bank anywhere. Everything else (balance sheet, cash book, journal, account
 * statements, bank accounts and bank transfers) is **hidden, not removed**:
 * the API, the database and the pages are all still there.
 *
 * Set this to `false` to bring every hidden screen back. The hidden pages
 * send a visitor to `/books` while it is `true`; their browser tests skip.
 */
export const BOOKS_SIMPLE = true;
