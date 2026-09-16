import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import type { PushPayload, PushProvider, PushResult, PushTarget } from "./types.js";

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  /** PEM, with `\n` escapes as it arrives from an environment variable. */
  privateKey: string;
}

/** The one call this provider makes; injected so tests use a fake transport. */
export type FcmSend = (message: {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  webpush: { fcmOptions: { link: string } };
}) => Promise<string>;

const APP_NAME = "rasi-fcm";

/** Error codes meaning the token is dead for good. */
const GONE = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
/** Error codes meaning Firebase is having trouble, not the message. */
const RETRY = new Set([
  "messaging/unavailable",
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
]);

/**
 * FCM over the HTTP v1 API through the Firebase Admin SDK
 * (notifications.md#fcm). Credentials come from the environment, never files.
 */
export class FcmProvider implements PushProvider {
  readonly name = "FCM" as const;
  private readonly transport: FcmSend;

  constructor(credentials: FcmCredentials | null, transport?: FcmSend) {
    if (transport) {
      this.transport = transport;
      return;
    }
    if (!credentials) throw new Error("FCM needs credentials or a transport");
    const app = getApps().some((existing) => existing.name === APP_NAME)
      ? getApp(APP_NAME)
      : initializeApp(
          {
            credential: cert({
              projectId: credentials.projectId,
              clientEmail: credentials.clientEmail,
              privateKey: credentials.privateKey.replace(/\\n/g, "\n"),
            }),
          },
          APP_NAME,
        );
    const messaging = getMessaging(app);
    this.transport = (message) => messaging.send(message);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (target.provider !== "FCM") {
      return { status: "failed", reason: "not an FCM subscription" };
    }
    try {
      await this.transport({
        token: target.fcmToken,
        notification: { title: payload.title, body: payload.body },
        data: {
          notificationId: payload.data.notificationId,
          entityType: payload.data.entityType ?? "",
          entityId: payload.data.entityId ?? "",
          url: payload.data.url,
        },
        webpush: { fcmOptions: { link: payload.data.url } },
      });
      return { status: "sent" };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const reason = error instanceof Error ? error.message : String(error);
      if (typeof code === "string" && GONE.has(code)) return { status: "gone", reason: code };
      if (typeof code !== "string" || RETRY.has(code)) return { status: "retry", reason: typeof code === "string" ? code : reason };
      return { status: "failed", reason: `${code} ${reason}` };
    }
  }
}
