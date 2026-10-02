import type { Metadata } from "next";

import { readListParams } from "../../../../../lib/list-params";
import { AccountStatementView } from "./account-statement";

export const metadata: Metadata = { title: "Account statement · Rasi" };

/** Books · one ledger account's statement (ADR-0018, US-105). Admin+. */
export default async function AccountStatementPage({
  params,
  searchParams,
}: PageProps<"/books/statements/[ledgerAccountId]">) {
  const { ledgerAccountId } = await params;
  return (
    <AccountStatementView
      ledgerAccountId={ledgerAccountId}
      initial={readListParams(await searchParams, ["from", "to"])}
    />
  );
}
