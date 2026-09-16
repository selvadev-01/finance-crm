import { describe, expect, it } from "vitest";

import { deliver, MAX_ATTEMPTS, outcome } from "./delivery.js";
import { FcmProvider } from "./fcm-provider.js";
import type { PushPayload } from "./types.js";
import { WebPushProvider } from "./web-push-provider.js";

const payload: PushPayload = {
  title: "Low collection on Line 3",
  body: "Suresh collected ₹80 of ₹100 from Guru",
  data: { notificationId: "ntf_1", entityType: "collection", entityId: "col_1", url: "/collections/col_1" },
};
const webTarget = { provider: "WEB_PUSH", endpoint: "https://push.example/abc", p256dh: "p", auth: "a" } as const;
const fcmTarget = { provider: "FCM", fcmToken: "token-1" } as const;
const vapid = { subject: "mailto:ops@example.com", publicKey: "pub", privateKey: "priv" };

const failWith = (fields: object) => async () => {
  throw Object.assign(new Error("push service said no"), fields);
};

describe("Web Push provider (US-071)", () => {
  it("sends the payload with the subscription's keys and the VAPID details", async () => {
    const calls: unknown[] = [];
    const provider = new WebPushProvider(vapid, async (...args) => {
      calls.push(args);
      return { statusCode: 201 };
    });
    await expect(provider.send(webTarget, payload)).resolves.toEqual({ status: "sent" });
    expect(calls).toEqual([
      [
        { endpoint: webTarget.endpoint, keys: { p256dh: "p", auth: "a" } },
        JSON.stringify(payload),
        { vapidDetails: vapid, TTL: 86_400 },
      ],
    ]);
  });

  it.each([
    [410, "gone"],
    [404, "gone"],
    [429, "retry"],
    [503, "retry"],
    [400, "failed"],
  ] as const)("a %i answers %s", async (statusCode, status) => {
    const provider = new WebPushProvider(vapid, failWith({ statusCode }));
    expect((await provider.send(webTarget, payload)).status).toBe(status);
  });

  it("a network error with no status is retried", async () => {
    const provider = new WebPushProvider(vapid, failWith({}));
    expect((await provider.send(webTarget, payload)).status).toBe("retry");
  });
});

describe("FCM provider (US-071)", () => {
  it("sends title, body and the deep link as data", async () => {
    const messages: unknown[] = [];
    const provider = new FcmProvider(null, async (message) => {
      messages.push(message);
      return "projects/x/messages/1";
    });
    await expect(provider.send(fcmTarget, payload)).resolves.toEqual({ status: "sent" });
    expect(messages[0]).toMatchObject({
      token: "token-1",
      notification: { title: payload.title, body: payload.body },
      data: { notificationId: "ntf_1", url: "/collections/col_1" },
    });
  });

  it.each([
    ["messaging/registration-token-not-registered", "gone"],
    ["messaging/unavailable", "retry"],
    ["messaging/invalid-argument", "failed"],
  ] as const)("%s answers %s", async (code, status) => {
    const provider = new FcmProvider(null, failWith({ code }));
    expect((await provider.send(fcmTarget, payload)).status).toBe(status);
  });
});

describe("delivery policy (notifications.md#delivery-and-retry)", () => {
  const now = new Date("2026-09-15T10:00:00Z");

  it("routes by the subscription's own provider, whatever else is configured", async () => {
    const sent: string[] = [];
    const web = new WebPushProvider(vapid, async () => {
      sent.push("web");
      return { statusCode: 201 };
    });
    const fcm = new FcmProvider(null, async () => {
      sent.push("fcm");
      return "ok";
    });
    await deliver([web, fcm], fcmTarget, payload);
    await deliver([web, fcm], webTarget, payload);
    expect(sent).toEqual(["fcm", "web"]);
    // A subscription whose provider is not configured waits rather than being lost.
    expect((await deliver([web], fcmTarget, payload)).status).toBe("retry");
  });

  it("retries after 1 min, 5 min, 30 min and 2 hours, then fails and deactivates", () => {
    const retry = { status: "retry", reason: "503" } as const;
    const delays = [1, 2, 3, 4].map((attempts) => {
      const next = outcome(retry, attempts, now);
      return next.status === "PENDING" ? (next.nextAttemptAt.getTime() - now.getTime()) / 60_000 : null;
    });
    expect(delays).toEqual([1, 5, 30, 120]);
    expect(outcome(retry, MAX_ATTEMPTS, now)).toMatchObject({ status: "FAILED", deactivate: true });
  });

  it("a gone subscription is deactivated at once; a refusal fails without deactivating", () => {
    expect(outcome({ status: "gone", reason: "410" }, 1, now)).toMatchObject({ status: "FAILED", deactivate: true });
    expect(outcome({ status: "failed", reason: "400" }, 1, now)).toMatchObject({ status: "FAILED", deactivate: false });
    expect(outcome({ status: "sent" }, 1, now)).toEqual({ status: "SENT" });
  });
});
