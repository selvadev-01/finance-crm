import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

const empty = { json: { data: [], nextCursor: null, hasMore: false } };
const results: ApiAnswers = {
  "/api/customers": empty,
  "/api/accounts": empty,
  "/api/staff": empty,
};

test("dump the palette for a page query", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withSavedLayout(page, "desktop");
  await signedInAs(page, "ADMIN", results);
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Search" }).click();
  await page
    .getByRole("dialog", { name: /Search customers/ })
    .getByRole("combobox")
    .fill("holi");
  await page.waitForTimeout(1500);

  const html = await page
    .getByRole("dialog", { name: /Search customers/ })
    .innerHTML();
  console.log("=== PALETTE ===\n" + html + "\n=== END ===");
  expect(true).toBe(true);
});
