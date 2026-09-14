import type { Metadata } from "next";

import { CollectionDetailView } from "./collection-detail";

export const metadata: Metadata = { title: "Collection · Rasi" };

/** S-17 collection detail: corrections and their approval trail (US-044). */
export default async function CollectionPage({
  params,
}: PageProps<"/collections/[collectionId]">) {
  const { collectionId } = await params;
  return <CollectionDetailView collectionId={collectionId} />;
}
