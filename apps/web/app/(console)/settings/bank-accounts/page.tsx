import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BOOKS_SIMPLE } from "../../../../lib/books-mode";
import { BankAccounts } from "./bank-accounts";

export const metadata: Metadata = { title: "Bank accounts · Rasi" };

/** Books (ADR-0018): the business's bank accounts. Admin+ read; Super Admin manages. */
export default function BankAccountsPage() {
  // Hidden in simple Books (lib/books-mode.ts), not removed.
  if (BOOKS_SIMPLE) redirect("/settings");
  return <BankAccounts />;
}
