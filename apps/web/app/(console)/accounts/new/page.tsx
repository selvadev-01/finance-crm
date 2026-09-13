import type { Metadata } from "next";

import { NewAccountForm } from "./new-account-form";

export const metadata: Metadata = { title: "New account · Rasi" };

/** S-04 create account (US-030, US-031, US-032). Admin and Super Admin. */
export default async function NewAccountPage({
  searchParams,
}: PageProps<"/accounts/new">) {
  const { customerId } = await searchParams;
  return (
    <NewAccountForm
      customerId={typeof customerId === "string" ? customerId : ""}
    />
  );
}
