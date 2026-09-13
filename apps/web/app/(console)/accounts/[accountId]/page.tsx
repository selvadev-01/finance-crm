import type { Metadata } from "next";

import { AccountDetailView } from "./account-detail";

export const metadata: Metadata = { title: "Account · Rasi" };

/** S-11 account detail: terms, balance and schedule; disburse (US-032). */
export default async function AccountPage({
  params,
}: PageProps<"/accounts/[accountId]">) {
  const { accountId } = await params;
  return <AccountDetailView accountId={accountId} />;
}
