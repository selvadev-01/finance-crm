import { z } from "zod";

import { route } from "./route.js";
import { errorSchema, idSchema, pageQuerySchema } from "./shared.js";

/**
 * M10 Notifications — the in-app centre (US-070), push devices (US-071) and
 * preferences (US-073). The centre is the system of record; push only
 * accelerates it.
 */

export const notificationCategorySchema = z.enum([
  "INFORMATION",
  "SUCCESS",
  "WARNING",
  "ALERT",
]);
export const notificationEventSchema = z.enum([
  "NEW_ASSIGNMENT",
  "LOW_COLLECTION",
  "EXTRA_COLLECTION",
  "MISSED_COLLECTION",
  "ACCOUNT_COMPLETED",
  "DAY_CLOSE_DISCREPANCY",
  "APPROVAL_REQUESTED",
  "NO_PAYMENT_COLLECTION",
  "HANDOVER_SUBMITTED",
  "HANDOVER_DISPUTED",
  "DAY_REOPENED",
  "RECONCILIATION_MISMATCH",
  "HOLIDAY_DECLARED",
  "HOLIDAY_REMOVED",
]);

export const notificationSchema = z.object({
  id: idSchema,
  category: notificationCategorySchema,
  eventType: notificationEventSchema,
  title: z.string(),
  body: z.string(),
  /** Where tapping it goes: the subject's entity and a path on the web app. */
  link: z
    .object({
      entityType: z.string().nullable(),
      entityId: z.string().nullable(),
      url: z.string(),
    })
    .nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const pushSubscriptionBodySchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("WEB_PUSH"),
    endpoint: z.url({ protocol: /^https$/ }),
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
    deviceLabel: z.string().trim().max(120).optional(),
  }),
  z.object({
    provider: z.literal("FCM"),
    fcmToken: z.string().min(1).max(4096),
    deviceLabel: z.string().trim().max(120).optional(),
  }),
]);

export const pushDeviceSchema = z.object({
  id: idSchema,
  provider: z.enum(["WEB_PUSH", "FCM"]),
  deviceLabel: z.string().nullable(),
  lastSeenAt: z.string(),
  isActive: z.boolean(),
});

export const preferencesSchema = z.object({
  categories: z.array(
    z.object({
      category: notificationCategorySchema,
      enabled: z.boolean(),
      /** ALERT cannot be switched off (M10). */
      locked: z.boolean(),
      /** Whether this category buzzes a phone at all (only ALERT and WARNING). */
      pushed: z.boolean(),
      /** Whether this category is also emailed: ALERT only, when email is configured. */
      emailed: z.boolean(),
    }),
  ),
});

export const notificationContract = {
  listNotifications: route({
    method: "GET",
    path: "/api/notifications",
    summary:
      "The caller's notifications, newest first, with the unread count (US-070)",
    query: pageQuerySchema.extend({
      unread: z.enum(["true", "false"]).optional(),
      category: notificationCategorySchema.optional(),
    }),
    responses: {
      200: z.object({
        data: z.array(notificationSchema),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
        unreadCount: z.number().int(),
      }),
      ...errors,
    },
  }),

  markRead: route({
    method: "POST",
    path: "/api/notifications/:notificationId/read",
    summary: "Mark one of the caller's notifications read",
    pathParams: z.object({ notificationId: idSchema }),
    body: z.object({}),
    responses: { 200: z.object({ unreadCount: z.number().int() }), ...errors },
  }),

  markAllRead: route({
    method: "POST",
    path: "/api/notifications/read-all",
    summary: "Mark every notification of the caller's read",
    body: z.object({}),
    responses: { 200: z.object({ unreadCount: z.number().int() }), ...errors },
  }),

  getPushConfig: route({
    method: "GET",
    path: "/api/push/config",
    summary:
      "Which push provider this deployment uses, and the VAPID public key",
    responses: {
      200: z.object({
        provider: z.enum(["WEB_PUSH", "FCM", "BOTH", "NONE"]),
        vapidPublicKey: z.string().nullable(),
      }),
      ...errors,
    },
  }),

  listDevices: route({
    method: "GET",
    path: "/api/push-subscriptions",
    summary: "The caller's registered push devices",
    responses: {
      200: z.object({ data: z.array(pushDeviceSchema) }),
      ...errors,
    },
  }),

  registerDevice: route({
    method: "POST",
    path: "/api/push-subscriptions",
    summary: "Register this device for push, or refresh it (US-071)",
    body: pushSubscriptionBodySchema,
    responses: { 201: pushDeviceSchema, ...errors, 422: errorSchema },
  }),

  deregisterDevice: route({
    method: "DELETE",
    path: "/api/push-subscriptions/:subscriptionId",
    summary:
      "Stop pushing to a device — the caller's own, or anyone's for an Admin",
    pathParams: z.object({ subscriptionId: idSchema }),
    responses: { 200: pushDeviceSchema, ...errors },
  }),

  getPreferences: route({
    method: "GET",
    path: "/api/notification-preferences",
    summary: "The caller's notification categories (US-073)",
    responses: { 200: preferencesSchema, ...errors },
  }),

  updatePreferences: route({
    method: "PATCH",
    path: "/api/notification-preferences",
    summary: "Switch categories on or off; ALERT stays on (US-073)",
    body: z.object({
      categories: z
        .array(
          z.object({
            category: notificationCategorySchema,
            enabled: z.boolean(),
          }),
        )
        .min(1)
        .max(4),
    }),
    responses: { 200: preferencesSchema, ...errors, 422: errorSchema },
  }),
} as const;

export type NotificationView = z.infer<typeof notificationSchema>;
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type PushDevice = z.infer<typeof pushDeviceSchema>;
export type NotificationPreferences = z.infer<typeof preferencesSchema>;
