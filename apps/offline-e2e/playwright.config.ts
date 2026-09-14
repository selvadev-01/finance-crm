import { defineConfig } from "@playwright/test";

/**
 * The offline end-to-end suite (offline-sync.md#testing, Phase 3 exit).
 *
 * **Runs against the real API and the one database, and leaves permanent
 * rows** — a new "Offline E2E" organization per run, with disbursed accounts,
 * collections and ledger postings, none of which can be deleted (decided
 * 2026-09-14, an explicit exception to "Tier 2 must never write an append-only
 * table"). Run it deliberately: `pnpm --filter offline-e2e test:offline`.
 *
 * Needs a production build (`pnpm build`): Serwist caches only in production
 * mode, so offline behaviour does not exist under `next dev`. The web app runs
 * with `next start` on :3000 — the API's trusted origin — and reaches the API
 * through the opt-in `RASI_LOCAL_API_ORIGIN` rewrite.
 *
 * Uses the installed Chrome (`channel: "chrome"`) rather than a downloaded
 * browser. A real mid-range Android device is still required for the Phase 3
 * exit; this suite does not replace it.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --env-file=../../.env ../api/dist/main.js",
      url: "http://localhost:3001/health/live",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Rewrites are baked in at build time, so the API origin must be set for
      // the build, not only for `next start`.
      command:
        "pnpm --filter web exec next build && pnpm --filter web exec next start --port 3000",
      url: "http://localhost:3000/sign-in",
      reuseExistingServer: false,
      timeout: 600_000,
      env: { RASI_LOCAL_API_ORIGIN: "http://localhost:3001" },
    },
  ],
});
