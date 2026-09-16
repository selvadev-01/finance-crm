import type { Metadata } from "next";

import { CashOverview } from "./cash-overview";

export const metadata: Metadata = { title: "Cash · Rasi" };

/** M08 in the console: handovers to acknowledge, the office hop, day close. */
export default function CashPage() {
  return <CashOverview />;
}
