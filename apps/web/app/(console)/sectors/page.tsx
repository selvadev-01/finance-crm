import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { SectorList } from "./sector-list";

export const metadata: Metadata = { title: "Sectors · Rasi" };

/** S-13 sector list (US-010). Admin and Super Admin. */
export default async function SectorsPage({
  searchParams,
}: PageProps<"/sectors">) {
  return (
    <SectorList initial={readListParams(await searchParams, ["inactive"])} />
  );
}
