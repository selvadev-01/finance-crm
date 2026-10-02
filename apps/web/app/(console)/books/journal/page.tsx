import type { Metadata } from "next";

import { Journal } from "./journal";

export const metadata: Metadata = { title: "Journal voucher · Rasi" };

/** Books · the manual journal (ADR-0018, US-106). Admins read; the owner posts. */
export default function JournalPage() {
  return <Journal />;
}
