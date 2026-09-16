import { describe, expect, it } from "vitest";

import { isKnownPushEndpoint } from "./push-endpoint.js";

describe("push endpoints the server will POST to", () => {
  it("accepts the browser push services and their subdomains", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-by3p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/abc",
    ]) {
      expect(isKnownPushEndpoint(endpoint)).toBe(true);
    }
  });

  it("refuses any other host, a look-alike, a port, credentials or plain http", () => {
    for (const endpoint of [
      "https://10.0.0.5/admin",
      "https://localhost/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pass@fcm.googleapis.com/x",
      "http://fcm.googleapis.com/x",
      "not a url",
    ]) {
      expect(isKnownPushEndpoint(endpoint)).toBe(false);
    }
  });
});
