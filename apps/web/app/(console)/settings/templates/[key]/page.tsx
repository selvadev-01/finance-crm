import type { Metadata } from "next";

import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Message template · Rasi" };

/**
 * US-074 · one message's words in English and Tamil, its channels, a live
 * preview and a test send. Super Admin only.
 */
export default async function TemplatePage({
  params,
}: PageProps<"/settings/templates/[key]">) {
  const { key } = await params;
  return <TemplateEditor templateKey={key} />;
}
