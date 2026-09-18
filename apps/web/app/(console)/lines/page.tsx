import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { LineList } from "./line-list";

export const metadata: Metadata = { title: "Lines · Rasi" };

/** S-12 line list (US-011, US-014). A Senior sees their own line. */
export default async function LinesPage({ searchParams }: PageProps<"/lines">) {
  return (
    <LineList
      initial={readListParams(await searchParams, ["sectorId", "inactive"])}
    />
  );
}
