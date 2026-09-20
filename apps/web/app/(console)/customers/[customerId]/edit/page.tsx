import type { Metadata } from "next";

import { EditCustomerForm } from "./edit-customer-form";

export const metadata: Metadata = { title: "Edit customer · Rasi" };

/** US-021: edit a customer's details, status and references. */
export default async function EditCustomerPage({
  params,
}: PageProps<"/customers/[customerId]/edit">) {
  const { customerId } = await params;
  return <EditCustomerForm customerId={customerId} />;
}
