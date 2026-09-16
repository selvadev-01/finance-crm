import type { Metadata } from "next";

import { DayCloseScreen } from "./day-close-view";

export const metadata: Metadata = { title: "Day close · Rasi" };

/** S-05 day close for one line and business date (US-060). */
export default async function DayClosePage({
  params,
}: PageProps<"/lines/[lineId]/day-closes/[businessDate]">) {
  const { lineId, businessDate } = await params;
  return <DayCloseScreen lineId={lineId} businessDate={businessDate} />;
}
