import type { Metadata } from "next";

import { CustomerDetailView } from "./customer-detail";

export const metadata: Metadata = { title: "Customer · Rasi" };

/** S-09 customer profile, first part: profile and references (US-020). */
export default async function CustomerPage({
  params,
}: PageProps<"/customers/[customerId]">) {
  const { customerId } = await params;
  return <CustomerDetailView customerId={customerId} />;
}
