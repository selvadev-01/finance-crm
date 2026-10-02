import type { Metadata } from "next";

import { JobStatusScreen } from "./job-status";

export const metadata: Metadata = { title: "Scheduled jobs · Rasi" };

/** M14 job status, Admin and Super Admin. Read-only. */
export default function JobsPage() {
  return <JobStatusScreen />;
}
