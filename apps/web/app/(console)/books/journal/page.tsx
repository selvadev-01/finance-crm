import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BOOKS_SIMPLE } from "../../../../lib/books-mode";
import { Journal } from "./journal";

export const metadata: Metadata = { title: "Journal voucher · Rasi" };

/** Books · the manual journal (ADR-0018, US-106). Admins read; the owner posts. */
export default function JournalPage() {
  // Hidden in simple Books (lib/books-mode.ts), not removed.
  if (BOOKS_SIMPLE) redirect("/books");
  return <Journal />;
}
