import type { Metadata } from "next";

import { readListParams } from "../../../../../lib/list-params";
import { LedgerPostings } from "./ledger-postings";

export const metadata: Metadata = { title: "Ledger postings · Rasi" };

/** M09 postings over `?from=&to=`, optionally one `?type=`. Admins and Super Admins. */
export default async function LedgerPostingsPage({
  searchParams,
}: PageProps<"/reports/trial-balance/postings">) {
  return (
    <LedgerPostings
      initial={readListParams(await searchParams, ["from", "to", "type"])}
    />
  );
}
