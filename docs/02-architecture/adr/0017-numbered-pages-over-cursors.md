# ADR-0017 — Numbered pages, walked over the API's cursors

**Status:** Accepted · **Date:** 2026-09-23 · **Revises:** [navigation-ia.md](../../05-ux/navigation-ia.md#url-state) ("paging is not in the URL"), and the `DataView` paging of [ADR-0013](0013-console-re-theme-and-headless-libraries.md)

## Context

Every console list read its next page by itself as the reader scrolled near the end, with "Show more" kept for the keyboard (2026-09-22). Each request asked for 200 rows.

The owner asked for "proper pagination on all pages", and then for ten rows a page.

That is a different reading model, not a different control. Scroll-loading answers "show me more"; a pager answers "where am I, how much is there, and take me somewhere". For a book of 1,000+ customers, or a month of collections, those are the questions actually being asked — a Senior looking for one customer wants to know they are 40 rows into 1,234, not to keep scrolling a list that silently grows.

The obvious way to number pages is an offset: `?page=17&pageSize=10`. [api-design.md](../api-design.md#pagination) rejected offsets for these lists and the reason has not changed — collections are inserted throughout the day, and an offset re-reads a shifting set, so a row can be skipped or shown twice while somebody pages through it. On a money list that is not cosmetic: a reader reconciling a day's collections would be reconciling against rows that move.

## Decision

**Pages are numbered, and each is walked to over the cursor the API already issues.** Nothing about the cursor changes; what changes is that the browser keeps the trail of cursors it has been given, so it can step back as well as forward.

**Every list response carries `total`** — how many rows the filter matches in all, ignoring `cursor` and `limit`. It is counted with **exactly the same `where` as the rows, scope predicate included** (M02), so no row a caller may not see is ever countable. In `apps/api` the filter is hoisted into one `const where` that both the `findMany` and the `count` read, so the two cannot drift apart.

**The pager is `ListPager`** in `@repo/ui`, passed as `DataView`'s footer: the range ("51–100 of 1,234 customers"), a Rows choice of 10, 25, 50 or 100, and First / Previous / Next with "Page 2 of 25" between them. The range is a live region, so stepping is announced rather than only drawn.

**Ten rows a page by default.** A page of ten is the whole list on a phone and a glanceable block on a computer. The reader may raise it; the choice lives in the URL while it differs from ten.

**The page is in the URL** — `page`, `after` (the cursor that page starts at) and `size` — so a reload or a shared link opens the same rows. Changing a filter drops all three, which is what a new filter means. A list inside a record page pages without the URL, because one set of params cannot serve two lists on one screen.

**The scroll-loading list stays where a pager has no room:** the notification panel and the Junior's field app, now on `useInfiniteQuery`.

## Consequences

**There is no "last page" button and no jumping to page 17.** A page has no address until the pages before it have been read. This is the price of the cursor, and it is the right price on a list whose rows are money: First, Previous and Next always land on rows that are really there, in an order that cannot repeat or drop one underneath the reader.

**Arriving at page 5 from a shared link, "Previous" is unavailable** — the browser holds that page's cursor from the URL but not the four before it. "First" is always available, and stepping forward from there rebuilds the trail. Showing a disabled control is honest; inventing a cursor would not be.

**Every list endpoint now runs a `COUNT` beside its page.** On the filtered, indexed queries these lists use, that is cheap; if a count ever becomes the slow half of a list, the answer is an index, not an estimate — a wrong total would make the pager lie about where the reader is.

**A total across a page is not shown.** The customer portfolio sums outstanding across accounts only when one page holds every account; past that it says nothing rather than quietly totalling ten of twelve. A sum labelled "total outstanding" that means "of this page" is worse than no sum (BR-11).

**Proven in a browser**, not only in types: `apps/offline-e2e/layout-tests/pager.spec.ts` drives the real screen against a fake 45-customer book and asserts the rows, the range, the cursor the browser sent, the URL, the size change and the filter reset.
