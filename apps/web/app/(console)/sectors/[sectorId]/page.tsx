import type { Metadata } from "next";

import { SectorDetail } from "./sector-detail";

export const metadata: Metadata = { title: "Sector · Rasi" };

/** S-13 sector detail → its lines (navigation-ia.md). */
export default async function SectorPage({
  params,
}: PageProps<"/sectors/[sectorId]">) {
  const { sectorId } = await params;
  return <SectorDetail sectorId={sectorId} />;
}
