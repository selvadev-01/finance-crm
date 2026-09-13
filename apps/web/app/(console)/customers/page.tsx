import type { Metadata } from "next";

import { CustomerList } from "./customer-list";

export const metadata: Metadata = { title: "Customers · Rasi" };

/** S-08 customer list, basic (US-020). Search is US-024. */
export default function CustomersPage() {
  return <CustomerList />;
}
