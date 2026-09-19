import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { COLLECTION_FILTER_KEYS } from "../report-filter-keys";
import { CollectionReport } from "./collection-report";

export const metadata: Metadata = { title: "Collection report · Rasi" };

/**
 * Collection report (US-086), for `?from=&to=` or the month so far, optionally
 * one sector, line, Junior or BR-08 class. Admins and Super Admins; a Senior
 * for their own line.
 */
export default async function CollectionReportPage({
  searchParams,
}: PageProps<"/reports/collection">) {
  return (
    <CollectionReport
      initial={readListParams(await searchParams, COLLECTION_FILTER_KEYS)}
    />
  );
}
