import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { REPORT_FILTER_KEYS } from "../report-parts";
import { InvestmentReport } from "./investment-report";

export const metadata: Metadata = { title: "Investment overview · Rasi" };

/**
 * Investment overview (US-085, PDF §22), for `?from=&to=` or the month so far,
 * optionally one sector or line. Admins and Super Admins; a Senior for their
 * own line.
 */
export default async function InvestmentReportPage({
  searchParams,
}: PageProps<"/reports/investment">) {
  return (
    <InvestmentReport
      initial={readListParams(await searchParams, REPORT_FILTER_KEYS)}
    />
  );
}
