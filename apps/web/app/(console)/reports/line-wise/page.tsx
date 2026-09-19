import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { REPORT_FILTER_KEYS } from "../report-filter-keys";
import { LineWiseReport } from "./line-wise-report";

export const metadata: Metadata = { title: "Line-wise report · Rasi" };

/**
 * Line-wise report (US-084, PDF §14), for `?from=&to=` or the month so far,
 * optionally one sector or line. Admins and Super Admins; a Senior for their
 * own line.
 */
export default async function LineWiseReportPage({
  searchParams,
}: PageProps<"/reports/line-wise">) {
  return (
    <LineWiseReport
      initial={readListParams(await searchParams, REPORT_FILTER_KEYS)}
    />
  );
}
