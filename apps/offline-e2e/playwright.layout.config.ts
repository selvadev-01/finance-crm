import { defineConfig } from "@playwright/test";

/**
 * The console's two layouts in a real browser (ADR-0016): the question the
 * installed app asks, switching, and each role's phone tabs.
 *
 * **Touches no database and no API.** Unlike the offline suite beside it,
 * there is no global setup: every `/api/…` request is answered inside the
 * browser (`layout-tests/fake-api.ts`), because a real sign-in writes a
 * `LOGIN` row to the append-only audit log, and this suite has no reason to.
 * The layout is decided entirely in the browser, so nothing is lost.
 *
 * Runs against the web app on :3000, reusing a `pnpm dev` already running or
 * starting one. Chromium's own install prompt cannot be driven here; it stays
 * a manual check (docs/06-delivery/backlog.md).
 */
export default defineConfig({
  testDir: "./layout-tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter web exec next dev --port 3000",
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
