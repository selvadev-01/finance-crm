import type { TemplateLanguage } from "@repo/contracts";

/** Each language as its readers name it (US-074). */
export const LANGUAGE_LABEL: Record<TemplateLanguage, string> = {
  EN: "English",
  TA: "தமிழ்",
};

export const LANGUAGES: readonly TemplateLanguage[] = ["EN", "TA"];
