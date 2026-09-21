import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * The Settings group — one sidebar item, its parts tabs — and "My profile",
 * in a real browser. **Writes nothing**: no sign-in, and every answer is a
 * fixture inside the browser.
 *
 * **This proves the screens, not the rules.** That a Senior is refused the
 * audit log is access control and is proven at the API in
 * `apps/api/test/rbac-matrix.e2e-spec.ts`. What is checked here is that the
 * strip does not offer a tab the API would refuse, which is a lesser claim.
 */

const settings: ApiAnswers = {
  "/api/settings": {
    json: {
      hasHistory: true,
      settings: [
        {
          key: "organisation.name",
          label: "Business name",
          description: "What this Rasi belongs to.",
          section: "ORGANISATION",
          group: "FREE",
          valueType: "TEXT",
          effect: "Applies at once, everywhere the name is shown.",
          value: "Sri Murugan Finance",
          defaultValue: null,
          isOverridden: false,
          editable: true,
          lockedReason: null,
        },
        {
          key: "account.defaultTermDays",
          label: "Default term",
          description: "What a new account starts N at.",
          section: "ACCOUNTS",
          group: "FORWARD_ONLY",
          valueType: "INTEGER",
          effect: "New accounts only; existing schedules keep their term.",
          value: "100",
          defaultValue: "100",
          isOverridden: false,
          editable: true,
          lockedReason: null,
        },
      ],
    },
  },
  "/api/holidays": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/notification-preferences": {
    json: {
      categories: [
        {
          category: "ALERT",
          enabled: true,
          locked: true,
          pushed: true,
          emailed: true,
        },
        {
          category: "WARNING",
          enabled: true,
          locked: false,
          pushed: true,
          emailed: false,
        },
        {
          category: "SUCCESS",
          enabled: false,
          locked: false,
          pushed: false,
          emailed: false,
        },
        {
          category: "INFORMATION",
          enabled: true,
          locked: false,
          pushed: false,
          emailed: false,
        },
      ],
    },
  },
  "/api/push/config": { json: { provider: "NONE", vapidPublicKey: null } },
};

const tabs = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Settings" });

test.describe("the Settings group", () => {
  test("opens a Super Admin on the business settings, with every tab", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SUPER_ADMIN", settings);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings");

    // `/settings` holds nothing itself: it opens the first tab for the role.
    await expect(page).toHaveURL(/\/settings\/business$/);
    await expect(
      page.getByRole("heading", { name: "Business settings" }),
    ).toBeVisible();

    for (const label of [
      "Business",
      "Holidays",
      "Notifications",
      "Audit log",
      "Refused attempts",
    ]) {
      await expect(tabs(page).getByRole("link", { name: label })).toBeVisible();
    }
    await expect(
      tabs(page).getByRole("link", { name: "Business" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("opens an Admin on the holidays, and never offers business settings", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", settings);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/settings\/holidays$/);
    await expect(
      tabs(page).getByRole("link", { name: "Business" }),
    ).toHaveCount(0);
    await expect(
      tabs(page).getByRole("link", { name: "Audit log" }),
    ).toBeVisible();
  });

  test("leaves a Senior the two tabs every role may open", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", settings);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/settings\/holidays$/);
    await expect(tabs(page).getByRole("link")).toHaveCount(2);
    await expect(
      tabs(page).getByRole("link", { name: "Notifications" }),
    ).toBeVisible();
  });

  test("carries the notification preferences that left the bell's panel", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", settings);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings/notifications");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("What to notify me about")).toBeVisible();
    // ALERT cannot be switched off — a CHECK backs it (US-073).
    await expect(page.getByRole("switch", { name: /Alert/ })).toBeDisabled();
    await expect(page.getByRole("switch", { name: /Warning/ })).toBeEnabled();
  });

  test("fits a phone without scrolling sideways", async ({ page }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "SUPER_ADMIN", settings);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/settings/business");
    await page.waitForLoadState("networkidle");

    await expect(tabs(page)).toBeVisible();
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows, "the settings tabs scroll the page sideways").toBe(false);
  });
});

const profile: ApiAnswers = {
  "/api/staff/staff-layout-test": {
    json: {
      staffProfileId: "staff-layout-test",
      userId: "user-layout-test",
      name: "Lakshmi K",
      email: "layout-test@rasi.test",
      phone: "+919876543210",
      staffCode: "ST-0002",
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: "2026-01-01",
      currentAssignment: {
        assignmentId: "asg-1",
        lineId: "line-1",
        lineCode: "LN-07",
        lineName: "Mylapore East",
        assignmentRole: "SENIOR",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      assignments: [],
    },
  },
};

test.describe("my profile", () => {
  test("shows who Rasi thinks the reader is, and the line they work today", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", profile);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Lakshmi K" }),
    ).toBeVisible();
    await expect(page.getByText("ST-0002")).toBeVisible();
    await expect(page.getByText("layout-test@rasi.test")).toBeVisible();
    await expect(page.getByText("+91 98765 43210")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "LN-07 · Mylapore East" }),
    ).toBeVisible();
    // Changing a name or a role is staff administration, not self-service.
    await expect(
      page.getByRole("button", { name: "Change password" }),
    ).toBeVisible();
  });

  test("is reached from the account menu", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", profile);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /account menu/ }).click();
    await page.getByRole("menuitem", { name: "My profile" }).click();

    await expect(page).toHaveURL(/\/profile$/);
  });

  test("shows less, not an error, when the reader is out of their own scope", async ({
    page,
  }) => {
    // A Senior between assignments matches no row in `staffScope`, so their
    // own staff record answers 404. The page is about them either way.
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", {});
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Karthik R" }),
    ).toBeVisible();
    await expect(page.getByText("layout-test@rasi.test")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change password" }),
    ).toBeVisible();
  });

  test("fits a phone, where the account block opens it", async ({ page }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", profile);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("link", { name: /My profile/ }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole("heading", { name: "Lakshmi K" }),
    ).toBeVisible();
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows, "the profile scrolls sideways at 360px").toBe(false);
  });
});
