import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import {
  DISCREPANCY_FILTER_KEYS,
  DiscrepancyReport,
} from "./discrepancy-report";

export const metadata: Metadata = { title: "Discrepancy report · Rasi" };

/**
 * Discrepancy report (M12, BR-17), optionally one sector, line or Junior:
 * what each Junior collected against the cash they counted out, day by day.
 * Admins and Super Admins; a Senior for their own line.
 */
export default async function DiscrepancyReportPage({
  searchParams,
}: PageProps<"/reports/discrepancy">) {
  return (
    <DiscrepancyReport
      initial={readListParams(await searchParams, DISCREPANCY_FILTER_KEYS)}
    />
  );
}
