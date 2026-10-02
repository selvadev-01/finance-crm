import type { Metadata } from "next";

import { TemplateList } from "./template-list";

export const metadata: Metadata = { title: "Message templates · Rasi" };

/**
 * US-074 message templates: every notification and email the business sends,
 * with its channels and which languages carry the business's own words.
 * Super Admin only; the API refuses every other role.
 */
export default function TemplatesPage() {
  return <TemplateList />;
}
