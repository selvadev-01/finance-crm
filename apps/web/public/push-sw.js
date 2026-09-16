/**
 * The console's push-only service worker (US-071), registered with scope
 * `/push/` so it controls no console page and caches nothing. It mirrors
 * `lib/notifications/push-worker.ts`, which the Junior's field worker uses;
 * files in `public/` are served as they are, not compiled.
 */
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = (event.data && event.data.json()) || {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || "Rasi", {
      body: payload.body || "You have a new notification.",
      tag: data.notificationId,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications";
  const target = new URL(path, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === target.origin);
      // `navigate` works only on a page this worker controls, and it controls
      // none; a console tab is focused and opened at the link in a new one.
      if (open && new URL(open.url).pathname === target.pathname) {
        await open.focus();
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
