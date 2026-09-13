import type { Metadata } from "next";

import { SectorList } from "./sector-list";

export const metadata: Metadata = { title: "Sectors · Rasi" };

/** S-13 sector list (US-010). Admin and Super Admin. */
export default function SectorsPage() {
  return <SectorList />;
}
