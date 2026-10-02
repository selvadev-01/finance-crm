import { z } from "zod";

import { notificationCategorySchema } from "./notification.contract.js";
import { route } from "./route.js";
import { errorSchema } from "./shared.js";

/**
 * M10 notification templates (US-074) — the words of every notification and
 * email, per business and per language. **Super Admin only**, and every
 * change audited (rbac-matrix.md, Notifications).
 *
 * Each message has a built-in default in English and Tamil. A saved template
 * overrides it for one language; resetting drops the override. Placeholders
 * are `{{name}}`, `{{#name}}…{{/name}}` (only when `name` has a value) and
 * `{{^name}}…{{/name}}` (only when it has none) — a placeholder the message
 * does not offer is refused with `422 TEMPLATE_INVALID`, naming the field.
 *
 * Email is built from these fields into the fixed, escaped layout: there is
 * no HTML to write and none is accepted. The link a message carries is not a
 * template field — it always points at the subject in Rasi.
 */

export const templateLanguageSchema = z.enum(["EN", "TA"]);

/** Where a message is listed on the screen. */
export const templateGroupSchema = z.enum([
  "COLLECTIONS",
  "ACCOUNTS",
  "CASH",
  "ORGANISATION",
  "SYSTEM",
  "SIGN_IN",
]);

const field = (max: number) => z.string().trim().min(1).max(max);

/** A message's words in one language. `title` and `body` are null for email-only messages. */
export const templateContentSchema = z.object({
  title: field(120).nullable(),
  body: field(500).nullable(),
  emailSubject: field(150),
  emailHeading: field(150),
  /** Paragraphs separated by a blank line. */
  emailBody: field(3000),
  emailAction: field(40),
  emailFooter: field(500),
});

export const templateChannelSchema = z.object({
  enabled: z.boolean(),
  /** What it is with no choice saved. */
  defaultEnabled: z.boolean(),
  /** Why it cannot be switched off; `null` when it can. */
  lockedReason: z.string().nullable(),
});

export const templateSummarySchema = z.object({
  /** Stable — `LOW_COLLECTION`. */
  key: z.string(),
  label: z.string(),
  description: z.string(),
  group: templateGroupSchema,
  /** `null` for an email-only message. */
  category: notificationCategorySchema.nullable(),
  /** Who receives it, in words. */
  recipients: z.string(),
  channels: z.object({
    /** The in-app centre is the record and always receives it (M10). */
    inApp: z.boolean(),
    /** `null` when the message has no push text. */
    push: templateChannelSchema.nullable(),
    email: templateChannelSchema,
  }),
  /** Which languages carry the business's own words. */
  overridden: z.array(templateLanguageSchema),
});

export const templateVariableSchema = z.object({
  name: z.string(),
  description: z.string(),
  sample: z.string(),
  /** Only the email fields may use it — `{{title}}`, `{{body}}`. */
  emailOnly: z.boolean(),
});

export const templateDetailSchema = templateSummarySchema.extend({
  variables: z.array(templateVariableSchema),
  versions: z.array(
    z.object({
      language: templateLanguageSchema,
      /** The words in force. */
      content: templateContentSchema,
      defaultContent: templateContentSchema,
      isOverridden: z.boolean(),
      /** When the override was last saved; `null` for the default. */
      updatedAt: z.string().nullable(),
    }),
  ),
});

export const templateListSchema = z.object({
  templates: z.array(templateSummarySchema),
  /** Whether each channel is configured on this server at all (M16). */
  delivery: z.object({
    push: z.boolean(),
    email: z.boolean(),
  }),
});

export const templatePreviewSchema = z.object({
  /** `null` for an email-only message. */
  title: z.string().nullable(),
  body: z.string().nullable(),
  email: z.object({
    subject: z.string(),
    text: z.string(),
    /** Self-contained: inline styles, no scripts, no images. */
    html: z.string(),
  }),
});

const keyParams = z.object({
  key: z
    .string()
    .regex(/^[A-Z][A-Z_]{0,63}$/),
});
const versionParams = keyParams.extend({ language: templateLanguageSchema });

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const notificationTemplateContract = {
  listTemplates: route({
    method: "GET",
    path: "/api/notification-templates",
    summary:
      "Every message Rasi sends, its channels and which languages are the business's own words (US-074)",
    responses: { 200: templateListSchema, ...errors },
  }),

  getTemplate: route({
    method: "GET",
    path: "/api/notification-templates/:key",
    summary:
      "One message: its placeholders and, per language, the words in force and the default (US-074)",
    pathParams: keyParams,
    responses: { 200: templateDetailSchema, ...errors },
  }),

  saveTemplate: route({
    method: "PATCH",
    path: "/api/notification-templates/:key/:language",
    summary: "Save the business's own words for a message in one language (US-074)",
    pathParams: versionParams,
    body: templateContentSchema,
    responses: { 200: templateDetailSchema, ...errors, 422: errorSchema },
  }),

  resetTemplate: route({
    method: "DELETE",
    path: "/api/notification-templates/:key/:language",
    summary: "Go back to the built-in words for a message in one language (US-074)",
    pathParams: versionParams,
    responses: { 200: templateDetailSchema, ...errors, 422: errorSchema },
  }),

  updateChannels: route({
    method: "PATCH",
    path: "/api/notification-templates/:key",
    summary:
      "Switch push or email on or off for a message; an alert's stay on (US-074)",
    pathParams: keyParams,
    body: z
      .object({ push: z.boolean().optional(), email: z.boolean().optional() })
      .refine((body) => body.push !== undefined || body.email !== undefined, {
        message: "Name push, email or both",
      }),
    responses: { 200: templateDetailSchema, ...errors, 422: errorSchema },
  }),

  previewTemplate: route({
    method: "POST",
    path: "/api/notification-templates/:key/preview",
    summary:
      "Render unsaved words with sample values, as the push and the email would read (US-074)",
    pathParams: keyParams,
    body: z.object({
      language: templateLanguageSchema,
      content: templateContentSchema,
    }),
    responses: { 200: templatePreviewSchema, ...errors, 422: errorSchema },
  }),

  sendTestTemplate: route({
    method: "POST",
    path: "/api/notification-templates/:key/test",
    summary:
      "Send the saved words, with sample values, to the caller's own devices and inbox (US-074)",
    pathParams: keyParams,
    body: z.object({ language: templateLanguageSchema }),
    responses: {
      200: z.object({
        /** Whether a notification went into the caller's own centre. */
        inApp: z.boolean(),
        /** How many of the caller's devices it was queued for. */
        pushDevices: z.number().int(),
        /** Whether an email was queued. */
        emailQueued: z.boolean(),
      }),
      ...errors,
    },
  }),
} as const;

export type TemplateLanguage = z.infer<typeof templateLanguageSchema>;
export type TemplateGroup = z.infer<typeof templateGroupSchema>;
export type TemplateContentInput = z.infer<typeof templateContentSchema>;
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export type TemplateList = z.infer<typeof templateListSchema>;
export type TemplatePreview = z.infer<typeof templatePreviewSchema>;
