"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TabLinks } from "../../../components/tab-links";
import { BOOKS_SIMPLE } from "../../../lib/books-mode";
import { currentHref } from "../../../lib/nav";
import { canManageOrganisation } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";

/** The Books group's parts (ADR-0018), as links wearing a tab strip. */
const ALL_TABS = [
  { href: "/books", label: "Summary", simple: true },
  { href: "/books/expenses", label: "Expenses", simple: true },
  { href: "/books/money", label: "Owner money & income", simple: true },
  { href: "/books/profit-and-loss", label: "Profit", simple: true },
  { href: "/books/balance-sheet", label: "Balance sheet", simple: false },
  { href: "/books/cash-book", label: "Cash book", simple: false },
  { href: "/books/journal", label: "Journal voucher", simple: false },
] as const;
// Simple Books (lib/books-mode.ts): the rest is hidden, not removed.
const BOOKS_TABS = ALL_TABS.filter((tab) => !BOOKS_SIMPLE || tab.simple).map(
  ({ href, label }) => ({ href, label }),
);

/**
 * Books (ADR-0018): the business's own money beside the loan book. One strip
 * of tabs above whichever part is open; each page brings its own header. The
 * strip is for Admins and above — the pages refuse anyone else themselves.
 */
export default function BooksLayout({ children }: { children: ReactNode }) {
  const me = useSignedIn();
  const pathname = usePathname();

  return (
    <>
      {canManageOrganisation(me.role) ? (
        <TabLinks
          label="Ledger"
          tabs={BOOKS_TABS}
          current={currentHref(
            pathname,
            BOOKS_TABS.map((tab) => tab.href),
          )}
        />
      ) : null}
      {children}
    </>
  );
}
