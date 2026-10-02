import type { Metadata } from "next";

import { BooksOverview } from "./books-overview";

export const metadata: Metadata = { title: "Books · Rasi" };

/** Books overview (ADR-0018): office cash, the banks, the month so far. Admin+. */
export default function BooksPage() {
  return <BooksOverview />;
}
