import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BOOKS_SIMPLE } from "../../../../lib/books-mode";
import { readListParams } from "../../../../lib/list-params";
import { CashBookView } from "./cash-book";

export const metadata: Metadata = { title: "Cash book · Rasi" };

/** Books · cash book of office cash or a bank (ADR-0018, US-105). Admin+. */
export default async function CashBookPage({
  searchParams,
}: PageProps<"/books/cash-book">) {
  // Hidden in simple Books (lib/books-mode.ts), not removed.
  if (BOOKS_SIMPLE) redirect("/books");
  return (
    <CashBookView
      initial={readListParams(await searchParams, ["from", "to", "bank"])}
    />
  );
}
