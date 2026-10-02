import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { ProfitAndLossView } from "./profit-and-loss";

export const metadata: Metadata = { title: "Profit and loss · Rasi" };

/** Books · profit and loss (ADR-0018, US-105). Admins and above. */
export default async function ProfitAndLossPage({
  searchParams,
}: PageProps<"/books/profit-and-loss">) {
  return (
    <ProfitAndLossView
      initial={readListParams(await searchParams, ["from", "to"])}
    />
  );
}
