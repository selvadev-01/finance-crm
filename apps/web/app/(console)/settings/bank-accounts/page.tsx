import type { Metadata } from "next";

import { BankAccounts } from "./bank-accounts";

export const metadata: Metadata = { title: "Bank accounts · Rasi" };

/** Books (ADR-0018): the business's bank accounts. Admin+ read; Super Admin manages. */
export default function BankAccountsPage() {
  return <BankAccounts />;
}
