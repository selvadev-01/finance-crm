/// <reference lib="webworker" />

/**
 * Push handling for a service worker (US-071): show what the server sent, and
 * on a tap focus an open window or open the notification's link. Shared by the
 * Junior's field worker; the console's `public/push-sw.js` mirrors it in plain
 * JavaScript because a file in `public/` is not compiled.
 *
 * The payload is `{ title, body, data: { notificationId, entityType, entityId,
 * url } }` (`@repo/notifications`). A malformed payload still shows something —
 * browsers penalise a push that shows no notification.
 */
interface PushData {
  title?: string;
  body?: string;
  data?: { notificationId?: string; url?: string };
}

export function installPushHandlers(
  scope: ServiceWorkerGlobalScope,
  /** Where a tap goes; the Junior's app opens its own notifications view. */
  openUrl: (data: PushData["data"]) => string,
): void {
  scope.addEventListener("push", (event) => {
    let payload: PushData;
    try {
      payload = (event.data?.json() as PushData | undefined) ?? {};
    } catch {
      payload = { body: event.data?.text() };
    }
    event.waitUntil(
      scope.registration.showNotification(payload.title ?? "Rasi", {
        body: payload.body ?? "You have a new notification.",
        tag: payload.data?.notificationId,
        data: payload.data ?? {},
      }),
    );
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = new URL(
      openUrl(event.notification.data as PushData["data"]),
      scope.location.origin,
    );
    event.waitUntil(
      (async () => {
        const windows = await scope.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const same = windows.find(
          (client) => new URL(client.url).pathname === target.pathname,
        );
        // `navigate` rejects for a tab this worker does not control — one
        // opened before the worker activated, since there is no clientsClaim.
        // Then the link opens in a new window rather than being lost.
        const navigated = same
          ? await same.navigate(target.href).catch(() => null)
          : null;
        if (navigated) {
          await navigated.focus();
          return;
        }
        await scope.clients.openWindow(target.href);
      })(),
    );
  });
}
