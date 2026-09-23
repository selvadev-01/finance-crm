import { defineConfig } from "@playwright/test";

/**
 * The regression journey: one business day, Admin → Senior → Junior, through
 * the real screens, API and database, with Chennai data (regression/data.ts).
 *
 * **Runs against the one database and leaves permanent rows** — a new
 * "Sri Kamakshi Finance — Regression <run id>" organization per run, with
 * staff, disbursed accounts, collections, a correction, a cash handover, a
 * closed day, ledger postings and audit rows, none of which can be deleted.
 * The user approved extending the offline suite's exception to this suite on
 * 2026-09-22. Run it deliberately: `pnpm --filter offline-e2e test:regression`.
 *
 * The journey stays online, so it needs no production build: an API on :3001
 * and a web app on :3000 already running (`pnpm dev`) are reused. Otherwise it
 * starts the built API (`pnpm build` first) and builds and starts the web app,
 * as the offline suite does. On a Sunday or a holiday the journey
 * skips: nothing is due, by rule.
 */
export default defineConfig({
  testDir: "./regression",
  globalSetup: "./regression/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: "node --env-file=../../.env ../api/dist/main.js",
      url: "http://localhost:3001/health/live",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command:
        "pnpm --filter web exec next build && pnpm --filter web exec next start --port 3000",
      url: "http://localhost:3000/sign-in",
      reuseExistingServer: true,
      timeout: 600_000,
      env: { RASI_LOCAL_API_ORIGIN: "http://localhost:3001" },
    },
  ],
});
