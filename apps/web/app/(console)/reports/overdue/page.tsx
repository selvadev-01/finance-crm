import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { OVERDUE_FILTER_KEYS, OverdueReport } from "./overdue-report";

export const metadata: Metadata = { title: "Overdue report · Rasi" };

/**
 * Overdue report (US-087), optionally one sector or line, narrowed to the
 * accounts overdue by at least a chosen number of days and ordered by the
 * longest overdue or the largest outstanding. Admins and Super Admins; a
 * Senior for their own line.
 */
export default async function OverdueReportPage({
  searchParams,
}: PageProps<"/reports/overdue">) {
  return (
    <OverdueReport
      initial={readListParams(await searchParams, OVERDUE_FILTER_KEYS)}
    />
  );
}
