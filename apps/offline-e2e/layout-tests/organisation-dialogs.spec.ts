import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-010, US-011 — the New sector and New line dialogs ask for a name and
 * nothing else. Codes are issued by the API (`SEC-00001`, `LIN-00001`) and can
 * never be changed, so there is no field to mistype one into.
 *
 * Writes nothing: every `/api/…` request is answered in the browser, and the
 * create is only observed. That the API issues the codes, and issues them
 * consecutively per organisation, is proven in `apps/api/test`.
 */

const sector = {
  id: "sec-1",
  code: "SEC-00001",
  name: "Chennai North",
  isActive: true,
};

const answers: ApiAnswers = {
  "/api/sectors": {
    json: { data: [sector], nextCursor: null, hasMore: false },
  },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/staffing": { json: { data: [], nextCursor: null, hasMore: false } },
};

test.describe("sector and line codes are issued, never typed", () => {
  test("the New sector dialog asks only for a name, and sends only a name", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers);

    const posted: unknown[] = [];
    await page.route("**/api/sectors", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: {
          ...sector,
          id: "sec-new",
          code: "SEC-00002",
          name: "Chennai South",
        },
      });
    });

    await page.goto("/sectors");
    await page.getByRole("button", { name: "New sector" }).first().click();

    const dialog = page.getByRole("dialog", { name: "New sector" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByLabel("Code")).toHaveCount(0);
    await expect(
      dialog.getByText("code is issued automatically"),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill("Chennai South");
    await dialog.getByRole("button", { name: "Create sector" }).click();

    await expect.poll(() => posted).toEqual([{ name: "Chennai South" }]);
  });

  test("the New line dialog asks only for a sector and a name", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers);

    const posted: unknown[] = [];
    await page.route("**/api/lines", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: {
          id: "line-new",
          sectorId: sector.id,
          code: "LIN-00001",
          name: "Royapuram",
          isActive: true,
        },
      });
    });

    await page.goto("/lines");
    await page.getByRole("button", { name: "New line" }).first().click();

    const dialog = page.getByRole("dialog", { name: "New line" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByLabel("Code")).toHaveCount(0);

    // The sector is still chosen, and still shows its issued code.
    await expect(dialog.getByLabel("Sector")).toBeVisible();
    await expect(dialog.getByRole("option", { name: /SEC-00001/ })).toHaveCount(
      1,
    );

    await dialog.getByLabel("Sector").selectOption(sector.id);
    await dialog.getByLabel("Name").fill("Royapuram");
    await dialog.getByRole("button", { name: "Create line" }).click();

    await expect
      .poll(() => posted)
      .toEqual([{ sectorId: sector.id, name: "Royapuram" }]);
  });
});
