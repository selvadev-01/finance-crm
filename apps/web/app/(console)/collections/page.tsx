import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { CollectionList } from "./collection-list";

export const metadata: Metadata = { title: "Collections · Rasi" };

/** S-16 collection list, date-bounded (US-045). */
export default async function CollectionsPage({
  searchParams,
}: PageProps<"/collections">) {
  return (
    <CollectionList
      initial={readListParams(await searchParams, [
        "from",
        "to",
        "line",
        "show",
      ])}
    />
  );
}
