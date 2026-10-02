import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { BalanceSheetView } from "./balance-sheet";

export const metadata: Metadata = { title: "Balance sheet · Rasi" };

/** Books · balance sheet (ADR-0018, US-105). Admins and above. */
export default async function BalanceSheetPage({
  searchParams,
}: PageProps<"/books/balance-sheet">) {
  return (
    <BalanceSheetView initial={readListParams(await searchParams, ["date"])} />
  );
}
