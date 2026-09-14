import type { Metadata } from "next";

import { ApprovalQueue } from "./approval-queue";

export const metadata: Metadata = { title: "Pending approvals · Rasi" };

/** S-18 pending approvals: corrections awaiting a decision (US-044). */
export default function PendingApprovalPage() {
  return <ApprovalQueue />;
}
