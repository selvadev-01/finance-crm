import webpush from "web-push";

import type { PushPayload, PushProvider, PushResult, PushTarget } from "./types.js";

export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** The one call this provider makes; injected so tests use a fake transport. */
export type WebPushSend = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { vapidDetails: VapidKeys; TTL: number },
) => Promise<{ statusCode: number }>;

/** How long a push service keeps an undelivered message: a day. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Web Push with VAPID (notifications.md#web-push-vapid) — Android Chrome, the
 * field platform, with no Firebase dependency.
 */
export class WebPushProvider implements PushProvider {
  readonly name = "WEB_PUSH" as const;

  constructor(
    private readonly vapid: VapidKeys,
    private readonly transport: WebPushSend = webpush.sendNotification as unknown as WebPushSend,
  ) {}

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (target.provider !== "WEB_PUSH") {
      return { status: "failed", reason: "not a Web Push subscription" };
    }
    try {
      await this.transport(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: TTL_SECONDS },
      );
      return { status: "sent" };
    } catch (error) {
      return classify(error);
    }
  }
}

/**
 * 404 and 410 mean the subscription no longer exists. 429 and 5xx are the
 * push service's own trouble. A thrown error with no status is the network.
 * Any other 4xx — a malformed request or a bad key — will not improve with
 * time.
 */
function classify(error: unknown): PushResult {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  const reason = error instanceof Error ? error.message : String(error);
  if (typeof statusCode !== "number") return { status: "retry", reason };
  if (statusCode === 404 || statusCode === 410) return { status: "gone", reason: `${statusCode}` };
  if (statusCode === 429 || statusCode >= 500) return { status: "retry", reason: `${statusCode}` };
  return { status: "failed", reason: `${statusCode} ${reason}` };
}
