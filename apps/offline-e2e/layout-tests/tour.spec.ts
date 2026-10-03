import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * The screen tour in a real browser. Writes nothing. It starts only when its
 * button is pressed, lights up the page's own parts, speaks English or
 * Tanglish, and fits a phone.
 */

const page$ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

const answers: ApiAnswers = {
  "/api/sectors/sec-1": {
    json: {
      id: "sec-1",
      code: "SEC-00001",
      name: "Chennai South",
      isActive: true,
    },
  },
  "/api/lines": page$([
    {
      id: "line-7",
      sectorId: "sec-1",
      code: "LN-07",
      name: "Mylapore East",
      isActive: true,
    },
  ]),
  "/api/staffing": page$([]),
};

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

async function openSector(page: Page, layout: "desktop" | "mobile") {
  await withSavedLayout(page, layout);
  await signedInAs(page, "ADMIN", answers);
  await page.goto("/sectors/sec-1");
  await expect(
    page.getByRole("heading", { name: "Chennai South" }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("screen tour", () => {
  test.beforeEach(async ({ page }) => {
    // Each test starts in English, whatever a previous one chose.
    await page.addInitScript(() =>
      window.localStorage.removeItem("rasi.tour.language"),
    );
  });

  test("starts only when asked, and walks the page's own parts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSector(page, "desktop");
    await expect(page.getByTestId("tour")).toHaveCount(0);

    await page.getByRole("button", { name: "Tour of this screen" }).click();
    const card = page.getByRole("dialog", { name: "One sector" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Step 1 of 2");

    await card.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "Its lines" })).toBeVisible();

    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("tour")).toHaveCount(0);
  });

  test("switches to Tanglish without losing its place, and remembers it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSector(page, "desktop");

    await page.getByRole("button", { name: "Tour of this screen" }).click();
    const tour = page.getByTestId("tour");
    await tour.getByRole("button", { name: "Next", exact: true }).click();
    await tour.getByRole("button", { name: "Tanglish" }).click();
    await expect(
      page.getByRole("dialog", { name: "Idhoda lines" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Purinjidhu!" }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Indha screen tour" }),
    ).toBeVisible();
  });

  test("fits a phone in the phone layout", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openSector(page, "mobile");

    await page.getByRole("button", { name: "Tour of this screen" }).click();
    const card = page.getByRole("dialog", { name: "One sector" });
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(await overflows(page)).toBe(false);
  });

  test("the sign-in screen has no tour", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/sign-in");

    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Tour of this screen" }),
    ).toHaveCount(0);
  });
});
