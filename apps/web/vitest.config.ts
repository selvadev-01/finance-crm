import { defineConfig } from "vitest/config";

/**
 * Unit tests for the web app's framework-free code — the offline engine in
 * `lib/offline` (offline-sync.md#testing). IndexedDB comes from
 * `fake-indexeddb`, a spec-conformant implementation, so the outbox's
 * transactions run as they would in a browser. Browser behaviour that needs a
 * real browser — the service worker, Background Sync, going offline — is the
 * Playwright suite's job.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.spec.ts"],
    environment: "node",
    setupFiles: ["fake-indexeddb/auto"],
  },
});
