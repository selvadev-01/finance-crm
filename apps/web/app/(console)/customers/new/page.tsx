import type { Metadata } from "next";

import { NewCustomerForm } from "./new-customer-form";

export const metadata: Metadata = { title: "New customer · Rasi" };

/** S-10 create customer (US-020). Admin and Super Admin. */
export default function NewCustomerPage() {
  return <NewCustomerForm />;
}
