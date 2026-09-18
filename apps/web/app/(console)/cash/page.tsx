import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { CashOverview } from "./cash-overview";

export const metadata: Metadata = { title: "Cash · Rasi" };

/** M08 in the console: handovers to acknowledge, the office hop, day close. */
export default async function CashPage({ searchParams }: PageProps<"/cash">) {
  return (
    <CashOverview
      initial={readListParams(await searchParams, ["line", "date"])}
    />
  );
}
