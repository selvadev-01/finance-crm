"use client";

import { notificationContract } from "@repo/contracts";

import { api } from "../api-client";

/**
 * Web Push registration for this browser (US-071). The console registers a
 * push-only worker at `/push-sw.js` with scope `/push/`; the Junior's field app
 * subscribes through its own `/route` worker, which handles push too. Either
 * way the subscription is sent to `POST /api/push-subscriptions`, which
 * refreshes it if this browser already registered.
 */
export type PushState =
  "unsupported" | "not-offered" | "blocked" | "off" | "on";

export const CONSOLE_PUSH_WORKER = {
  url: "/push-sw.js",
  scope: "/push/",
} as const;

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function vapidKey(): Promise<string | null> {
  const result = await api(notificationContract.getPushConfig, {});
  if (!result.ok) return null;
  const { provider, vapidPublicKey } = result.body;
  return provider === "WEB_PUSH" || provider === "BOTH" ? vapidPublicKey : null;
}

async function registration(worker: { url: string; scope: string }) {
  return (
    (await navigator.serviceWorker.getRegistration(worker.scope)) ??
    (await navigator.serviceWorker.register(worker.url, {
      scope: worker.scope,
    }))
  );
}

/** Where this browser stands, without prompting. */
export async function pushState(worker: {
  url: string;
  scope: string;
}): Promise<PushState> {
  if (!supported()) return "unsupported";
  const key = await vapidKey().catch(() => null);
  if (!key) return "not-offered";
  if (Notification.permission === "denied") return "blocked";
  const existing = await navigator.serviceWorker.getRegistration(worker.scope);
  const subscription = await existing?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/**
 * Asks for permission (only ever from a tap) and registers the subscription.
 * Returns the state afterwards; a refusal is `blocked`, not an error.
 */
export async function enablePush(
  worker: { url: string; scope: string },
  deviceLabel: string,
): Promise<PushState> {
  if (!supported()) return "unsupported";
  const key = await vapidKey();
  if (!key) return "not-offered";
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const worked = await registration(worker);
  await navigator.serviceWorker.ready;
  const subscription =
    (await worked.pushManager.getSubscription()) ??
    (await worked.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(key),
    }));
  const json = subscription.toJSON();
  const saved = await api(notificationContract.registerDevice, {
    body: {
      provider: "WEB_PUSH",
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      deviceLabel,
    },
  });
  return saved.ok ? "on" : "off";
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
