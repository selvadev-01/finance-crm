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
  await expect(page.getByText("Choose device layout")).toHaveCount(0);
  await expect(tabBar(page)).toHaveCount(0);
});

test("the installed app asks first, and keeps the answer", async ({ page }) => {
  await asInstalledApp(page);
  await signedInAs(page, "ADMIN");
  await page.goto("/customers");

  await expect(
    page.getByRole("heading", { name: "Choose device layout" }),
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
  await expect(page.getByText("Choose device layout")).toHaveCount(0);
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

/**
 * Never in "More" for anyone: each is a tab inside Settings, reached through
 * the one Settings item. Notifications is not here either — it is the bell.
 */
const SETTINGS_PARTS = [
  "Business settings",
  "Holidays",
  "Audit log",
  "Refused attempts",
  "Notifications",
];

const EXPECTED: Record<
  ConsoleRole,
  { tabs: string[]; inMore: string[]; notInMore: string[] }
> = {
  SUPER_ADMIN: {
    tabs: ["Home", "Collections", "Customers", "Ledger", "More"],
    inMore: ["Sectors", "Team", "Settings"],
    notInMore: SETTINGS_PARTS,
  },
  ADMIN: {
    tabs: ["Home", "Collections", "Customers", "Cash", "More"],
    inMore: ["Sectors", "Team", "Settings"],
    notInMore: SETTINGS_PARTS,
  },
  SENIOR: {
    tabs: ["Home", "Collections", "Cash", "Customers", "More"],
    inMore: ["Reports", "Lines", "Team", "Settings"],
    notInMore: ["Sectors", ...SETTINGS_PARTS],
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
    // The bars of the Stitch homes in "Rasi Mobile, all roles" (2026-10-02).
    await expect(tabs.getByRole("listitem")).toHaveText(expected.tabs);

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
