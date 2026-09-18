import { isCalendarDate } from "@repo/domain";
import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { SectorComparison } from "./sector-comparison";

export const metadata: Metadata = { title: "Sector comparison · Rasi" };

/** Sector comparison (US-081), for `?date=` or today. Admin and Super Admin. */
export default async function SectorComparisonPage({
  searchParams,
}: PageProps<"/dashboard/sectors">) {
  const { date } = readListParams(await searchParams, ["date"]);
  // A date that is not a real day is ignored rather than failing the page.
  return (
    <SectorComparison
      initial={date !== undefined && isCalendarDate(date) ? { date } : {}}
    />
  );
}
