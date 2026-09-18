import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { CustomerDetailView } from "./customer-detail";

export const metadata: Metadata = { title: "Customer · Rasi" };

/** S-09 Customer 360: profile and references (US-020), and accounts (US-022). */
export default async function CustomerPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]">) {
  const { customerId } = await params;
  return (
    <CustomerDetailView
      customerId={customerId}
      initial={readListParams(await searchParams, ["tab"])}
    />
  );
}
