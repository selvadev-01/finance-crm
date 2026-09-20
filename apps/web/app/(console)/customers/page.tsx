import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { CustomerList } from "./customer-list";

export const metadata: Metadata = { title: "Customers · Rasi" };

/** S-08 customer list (US-020) with search (US-024). */
export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  return (
    <CustomerList initial={readListParams(await searchParams, ["q", "line"])} />
  );
}
