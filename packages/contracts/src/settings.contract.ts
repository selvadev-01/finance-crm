import { z } from "zod";

import { route } from "./route.js";
import { errorSchema } from "./shared.js";

/**
 * M15 Settings — business settings (US-094, S-28). **Super Admin only**, and
 * every change audited with before and after (rbac-matrix.md).
 *
 * The question this contract answers is not "what can be configured" but
 * **what can be configured safely**. Every setting declares which of three
 * groups it belongs to, and the group is what the API enforces:
 *
 * - `FREE` — changing it rewrites nothing. The new value simply applies.
 * - `FORWARD_ONLY` — it is read **once, when a record is created**, and copied
 *   onto that record. Existing accounts keep the value they were created with,
 *   because their schedules were generated from it (BR-04/06/07).
 * - `LOCKED` — it cannot be changed, either at all or once the business has
 *   history. Every posted amount and every generated slot was written under
 *   the current value, so changing it would silently restate the past. The API
 *   refuses with `SETTING_IMMUTABLE` or `SETTING_LOCKED_BY_HISTORY` — a
 *   `LOCKED` setting is never merely hidden in the screen.
 *
 * Values cross as **strings**, whatever their type: an integer as digits, and
 * a money-shaped setting — should one ever be added — as a decimal string,
 * never a JSON number (BR-11).
 */

export const settingGroupSchema = z.enum(["FREE", "FORWARD_ONLY", "LOCKED"]);

/** Where the setting is shown on S-28. */
export const settingSectionSchema = z.enum(["ORGANISATION", "ACCOUNTS"]);

export const settingValueTypeSchema = z.enum(["INTEGER", "TEXT"]);

export const businessSettingSchema = z.object({
  /** Dotted and stable — `account.defaultTermDays`. */
  key: z.string(),
  label: z.string(),
  /** What the value means. */
  description: z.string(),
  section: settingSectionSchema,
  group: settingGroupSchema,
  valueType: settingValueTypeSchema,
  /** What happens when it changes — the sentence the screen shows. */
  effect: z.string(),
  /** The value in force. Always a string (BR-11). */
  value: z.string(),
  /** The built-in default, or `null` where the setting has none. */
  defaultValue: z.string().nullable(),
  /** Whether a stored override is in force, rather than the default. */
  isOverridden: z.boolean(),
  /** Whether this Super Admin can change it **right now**. */
  editable: z.boolean(),
  /** Why it cannot be changed; `null` when it can. */
  lockedReason: z.string().nullable(),
});

export const businessSettingsSchema = z.object({
  settings: z.array(businessSettingSchema),
  /**
   * Whether the organisation has any account at all. Once it has, the values
   * that money and schedules were written under are history.
   */
  hasHistory: z.boolean(),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const settingsContract = {
  getSettings: route({
    method: "GET",
    path: "/api/settings",
    summary:
      "Every business setting with its value, its default and whether it may be changed (US-094, S-28)",
    responses: { 200: businessSettingsSchema, ...errors },
  }),

  updateSetting: route({
    method: "PATCH",
    path: "/api/settings/:key",
    summary:
      "Change one business setting, or reset it to its built-in default (US-094)",
    pathParams: z.object({ key: z.string().min(1).max(80) }),
    body: z.object({
      /**
       * The new value as a string, or `null` to drop the override and go back
       * to the built-in default. A setting with no default cannot be reset.
       */
      value: z.string().max(200).nullable(),
    }),
    /** The whole set comes back: one change can lock or unlock another. */
    responses: { 200: businessSettingsSchema, ...errors, 422: errorSchema },
  }),
} as const;

export type BusinessSetting = z.infer<typeof businessSettingSchema>;
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type SettingGroup = z.infer<typeof settingGroupSchema>;
