/**
 * The push layer (notifications.md). Framework-free: no NestJS, no Prisma —
 * the API maps its rows to these shapes.
 */

export type ProviderName = "WEB_PUSH" | "FCM";

/** One device a notification is delivered to, as the provider needs it. */
export type PushTarget =
  | {
      provider: "WEB_PUSH";
      endpoint: string;
      p256dh: string;
      auth: string;
    }
  | { provider: "FCM"; fcmToken: string };

/**
 * What lands on a lock screen. **No figures beyond what the recipient may
 * already see** (notifications.md#payload): the caller builds it from the
 * recipient's own notification.
 */
export interface PushPayload {
  title: string;
  body: string;
  data: {
    notificationId: string;
    entityType: string | null;
    entityId: string | null;
    /** Where tapping opens, a path on the web app. */
    url: string;
  };
}

/**
 * - `sent` — accepted by the push service.
 * - `retry` — a transient failure; try again later.
 * - `gone` — the subscription is permanently dead (404/410, unregistered
 *   token); deactivate it and never retry.
 * - `failed` — refused for a reason retrying will not fix.
 */
export type PushResult =
  | { status: "sent" }
  | { status: "retry"; reason: string }
  | { status: "gone"; reason: string }
  | { status: "failed"; reason: string };

export interface PushProvider {
  readonly name: ProviderName;
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}
