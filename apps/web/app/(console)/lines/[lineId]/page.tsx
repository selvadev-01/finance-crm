import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { LINE_FILTERS, LineDetail } from "./line-detail";

export const metadata: Metadata = { title: "Line · Rasi" };

/** S-12 line detail: staff today and assignment history (US-014, US-015). */
export default async function LinePage({
  params,
  searchParams,
}: PageProps<"/lines/[lineId]">) {
  const { lineId } = await params;
  return (
    <LineDetail
      lineId={lineId}
      initial={readListParams(await searchParams, Object.keys(LINE_FILTERS))}
    />
  );
}
