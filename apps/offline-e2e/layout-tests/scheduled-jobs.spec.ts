import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * M14's job status on `/settings/jobs`, in a real browser. **Writes nothing**:
 * every answer is a fixture. What the worker records is proven in
 * `apps/api/test/jobs/job-handlers.spec.ts`; who may read it, in the RBAC
 * harness. This proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };

const never = (job: string, schedule: string) => ({
  job,
  schedule,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastOutcome: null,
  lastError: null,
  lastSucceededAt: null,
  deadLetteredAt: null,
});

const overview = {
  workerEnabled: true,
  jobs: [
    {
      ...never("reconcile-balances", "0 1 * * *"),
      lastStartedAt: "2026-09-23T19:30:00.000Z",
      lastFinishedAt: "2026-09-23T19:30:04.000Z",
      lastOutcome: "FAILED",
      lastError: "DomainError LEDGER_MISMATCH",
      lastSucceededAt: "2026-09-22T19:30:03.000Z",
      deadLetteredAt: "2026-09-23T21:10:00.000Z",
    },
    {
      ...never("flag-overdue-accounts", "30 0 * * *"),
      lastStartedAt: "2026-09-23T19:00:00.000Z",
      lastFinishedAt: "2026-09-23T19:00:01.000Z",
      lastOutcome: "SUCCEEDED",
      lastSucceededAt: "2026-09-23T19:00:01.000Z",
    },
    never("purge-idempotency-keys", "0 2 * * *"),
    never("dispatch-notifications", "* * * * *"),
    never("dispatch-emails", "* * * * *"),
    // Overridden on this server: shown as it is, not as the default.
    never("deactivate-stale-subscriptions", "0 4 * * 1"),
  ],
};

const answers = (json: unknown): ApiAnswers => ({ "/api/jobs": { json } });

const card = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Scheduled jobs" })
    .getByRole("listitem")
    .filter({ hasText: name });

test.describe("scheduled jobs (M14)", () => {
  test("shows each job's last run, a failure's code, and when it gave up", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers(overview));
    await page.goto("/settings/jobs");

    await expect(
      page.getByRole("heading", { name: "Scheduled jobs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Scheduled jobs" }).getByRole("listitem"),
    ).toHaveCount(6);

    const reconcile = card(page, "Nightly reconciliation");
    await expect(reconcile.getByText("Failed", { exact: true })).toBeVisible();
    await expect(
      reconcile.getByText("DomainError LEDGER_MISMATCH", { exact: false }),
    ).toBeVisible();
    await expect(
      reconcile.getByText("Gave up after five attempts", { exact: false }),
    ).toBeVisible();

    await expect(
      card(page, "Overdue accounts").getByText("Succeeded", { exact: true }),
    ).toBeVisible();
    await expect(
      card(page, "Sync key clean-up").getByText(
        "Has not run yet for this business.",
      ),
    ).toBeVisible();
    await expect(
      card(page, "Stale device clean-up").getByText("Cron 0 4 * * 1", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("The job worker is off on this server", { exact: false }),
    ).toHaveCount(0);
  });

  test("says so when this server does not run the worker", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(
      page,
      "SUPER_ADMIN",
      answers({ ...overview, workerEnabled: false }),
    );
    await page.goto("/settings/jobs");

    await expect(
      page.getByText("The job worker is off on this server", { exact: false }),
    ).toBeVisible();
  });

  test("is a Settings tab for an Admin, and not for a Senior", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers(overview));
    await page.goto("/settings/jobs");
    await expect(
      page.getByRole("link", { name: "Scheduled jobs" }),
    ).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await signedInAs(page, "SENIOR", answers(overview));
    await page.goto("/settings/jobs");
    await expect(
      page.getByText("Scheduled jobs are for Super Admins and Admins."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Scheduled jobs" }),
    ).toHaveCount(0);
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers(overview));
      await page.setViewportSize(viewport);
      await page.goto("/settings/jobs");

      await expect(
        card(page, "Nightly reconciliation").getByText("Failed", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    });
  }
});
