import type { Metadata } from "next";

import { CollectionList } from "./collection-list";

export const metadata: Metadata = { title: "Collections · Rasi" };

/** S-16 collection list, date-bounded (US-045). */
export default function CollectionsPage() {
  return <CollectionList />;
}
