import { expect, type Page, test } from "@playwright/test";

import {
  asInstalledApp,
  type ConsoleRole,
  signedInAs,
  withSavedLayout,
} from "./fake-api";

/**
 * ADR-0016: the console's layout is chosen per device. See
 * playwright.layout.config.ts — no database, no API.
 */

/** One of the chooser's two options, clicked as a person would: on its card. */
const option = (page: Page, label: "Phone" | "Computer") =>
  page.locator("label").filter({ hasText: new RegExp(`^${label}`) });

const tabBar = (page: Page) =>
  page.getByRole("navigation", { name: "Console" }).filter({
    has: page.getByRole("button", { name: "More" }),
  });

test("a browser tab is never asked, and shows the computer layout", async ({
  page,
}) => {
  await signedInAs(page, "ADMIN");
  await page.goto("/customers");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await expect(page.getByText("How will you use Rasi here?")).toHaveCount(0);
  await expect(tabBar(page)).toHaveCount(0);
});

test("the installed app asks first, and keeps the answer", async ({ page }) => {
  await asInstalledApp(page);
  await signedInAs(page, "ADMIN");
  await page.goto("/customers");

  await expect(
    page.getByRole("heading", { name: "How will you use Rasi here?" }),
  ).toBeVisible();
  // A phone-sized touch screen: the phone layout is the suggestion.
  await expect(page.getByRole("radio", { name: /Phone/ })).toBeChecked();
  await page.getByRole("button", { name: "Use the phone layout" }).click();

  await expect(tabBar(page)).toBeVisible();
  await expect(
    tabBar(page).getByRole("link", { name: "Customers" }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(tabBar(page)).toBeVisible();
  await expect(page.getByText("How will you use Rasi here?")).toHaveCount(0);
});

test("the layout switches from the account menu and back from More", async ({
  page,
}) => {
  await signedInAs(page, "ADMIN");
  await page.goto("/customers");

  await page.getByRole("button", { name: /account menu/ }).click();
  await page.getByRole("menuitem", { name: "Layout: computer" }).click();
  await option(page, "Phone").click();
  await page.getByRole("button", { name: "Use the phone layout" }).click();
  await expect(tabBar(page)).toBeVisible();

  await tabBar(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Layout: phone" }).click();
  await option(page, "Computer").click();
  await page.getByRole("button", { name: "Use the computer layout" }).click();
  await expect(tabBar(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
});

const EXPECTED: Record<
  ConsoleRole,
  { dashboardTab: string; inMore: string[]; notInMore: string[] }
> = {
  SUPER_ADMIN: {
    dashboardTab: "Overview",
    inMore: ["Sectors", "Audit log", "Business settings"],
    notInMore: [],
  },
  ADMIN: {
    dashboardTab: "Today",
    inMore: ["Sectors", "Audit log", "Refused attempts"],
    notInMore: ["Business settings"],
  },
  SENIOR: {
    dashboardTab: "My line",
    inMore: ["Reports", "Lines", "Team", "Holidays"],
    notInMore: [
      "Sectors",
      "Audit log",
      "Refused attempts",
      "Business settings",
    ],
  },
};

for (const [role, expected] of Object.entries(EXPECTED) as [
  ConsoleRole,
  (typeof EXPECTED)[ConsoleRole],
][]) {
  const who = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", SENIOR: "Senior" }[
    role
  ];
  test(`a ${who}'s phone shows their tabs, and More holds only what they may see`, async ({
    page,
  }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, role);
    await page.goto("/customers");

    const tabs = tabBar(page);
    await expect(tabs.getByRole("listitem")).toHaveText([
      expected.dashboardTab,
      "Collections",
      "Customers",
      "Cash",
      "More",
    ]);

    await tabs.getByRole("button", { name: "More" }).click();
    const more = page.getByRole("navigation", { name: "More" });
    for (const label of expected.inMore) {
      await expect(more.getByRole("link", { name: label })).toBeVisible();
    }
    for (const label of expected.notInMore) {
      await expect(more.getByRole("link", { name: label })).toHaveCount(0);
    }
  });
}
