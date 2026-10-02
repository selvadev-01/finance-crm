import { expect, type Page, test } from "@playwright/test";

import { signedInAs, withSavedLayout } from "./fake-api";

/**
 * The reports index (S-22–26): one link per built report. **Writes
 * nothing** — the page reads no data of its own, only `/api/me` for the
 * console frame, which the fake answers.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const REPORTS = [
  ["Line-wise", "/reports/line-wise"],
  ["Collection", "/reports/collection"],
  ["Overdue", "/reports/overdue"],
  ["Discrepancies", "/reports/discrepancy"],
  ["Investment", "/reports/investment"],
] as const;

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

/** The report cards, scoped to the page's own list, not the sidebar. */
const card = (page: Page, title: string) =>
  page.getByRole("main").getByRole("link", { name: new RegExp(`^${title}`) });

test.describe("the reports index", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "SENIOR"] as const) {
    test(`${role} sees a link to each of the five reports`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role);
      await page.goto("/reports");
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Reports", exact: true }),
      ).toBeVisible();
      for (const [title, href] of REPORTS) {
        await expect(card(page, title)).toHaveAttribute("href", href);
      }
    });
  }

  test("a card opens its report", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN");
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");

    await card(page, "Overdue").click();
    await expect(page).toHaveURL(/\/reports\/overdue$/);
  });
});

test.describe("the reports index at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN");
      await page.setViewportSize(viewport);
      await page.goto("/reports");
      await page.waitForLoadState("networkidle");

      await expect(card(page, "Investment")).toBeVisible();
      expect(
        await overflows(page),
        `the index scrolls sideways at ${name}`,
      ).toBe(false);
    });
  }
});
