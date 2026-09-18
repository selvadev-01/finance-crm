/**
 * The push services browsers actually subscribe with. A Web Push endpoint is a
 * URL the client hands the server, and the server then POSTs to it, so an
 * unrestricted endpoint would let any signed-in user point the API at an
 * arbitrary host. Only these hosts (or their subdomains) are accepted.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge on Windows (wns2-*.notify.windows.com)
  "push.apple.com", // Safari (web.push.apple.com)
] as const;

export function isKnownPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username ||
    url.password
  )
    return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(
    (known) => host === known || host.endsWith(`.${known}`),
  );
}
