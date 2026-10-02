"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TabLinks } from "../../../components/tab-links";
import { currentHref } from "../../../lib/nav";
import { canManageOrganisation } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";

/** The Books group's parts (ADR-0018), as links wearing a tab strip. */
const BOOKS_TABS = [
  { href: "/books", label: "Overview" },
  { href: "/books/expenses", label: "Expenses" },
  { href: "/books/money", label: "Contra, receipts & drawings" },
  { href: "/books/profit-and-loss", label: "Profit and loss" },
  { href: "/books/balance-sheet", label: "Balance sheet" },
  { href: "/books/cash-book", label: "Cash book" },
  { href: "/books/journal", label: "Journal voucher" },
] as const;

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
          label="Books"
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
