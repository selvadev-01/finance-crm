import type { Metadata } from "next";

import { BOOKS_SIMPLE } from "../../../lib/books-mode";
import { BooksOverview } from "./books-overview";
import { SimpleSummary } from "./simple-summary";

export const metadata: Metadata = { title: "Books · Rasi" };

/**
 * Books (ADR-0018). Admin+. The simple summary while `BOOKS_SIMPLE` is on;
 * the full overview (office cash, banks, the month, fund flow) otherwise.
 */
export default function BooksPage() {
  return BOOKS_SIMPLE ? <SimpleSummary /> : <BooksOverview />;
}
