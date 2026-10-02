import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-13 — a sector and its lines (US-010, US-011) in a real browser. Writes
 * nothing. Which sectors a caller may read is proven over HTTP; this proves
 * the page, and that only Admins are offered the sector's changes.
 */

const COMPUTER = { width: 1280, height: 900 };

const sector = {
  id: "sec-1",
  code: "SEC-00001",
  name: "Chennai South",
  isActive: true,
};

const page$ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

const lines = [
  {
    id: "line-7",
    sectorId: "sec-1",
    code: "LN-07",
    name: "Mylapore East",
    isActive: true,
  },
  {
    id: "line-8",
    sectorId: "sec-1",
    code: "LN-08",
    name: "Adyar Market",
    isActive: true,
  },
  {
    id: "line-9",
    sectorId: "sec-1",
    code: "LN-09",
    name: "Besant Nagar Old",
    isActive: false,
  },
];

const staffing = [
  {
    lineId: "line-7",
    code: "LN-07",
    name: "Mylapore East",
    sectorId: "sec-1",
    senior: { staffProfileId: "staff-karthik", name: "Karthik Rajendran" },
    juniorCount: 2,
    customerCount: 64,
  },
  {
    lineId: "line-8",
    code: "LN-08",
    name: "Adyar Market",
    sectorId: "sec-1",
    senior: null,
    juniorCount: 1,
    customerCount: 23,
  },
];

function answers(sectorLines: unknown[] = lines): ApiAnswers {
  return {
    "/api/sectors/sec-1": { json: sector },
    "/api/lines": page$(sectorLines),
    "/api/staffing": page$(staffing),
  };
}

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("sector detail (S-13)", () => {
  test("an Admin sees the sector, its lines with today's staffing, and its changes", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers());
    await page.setViewportSize(COMPUTER);
    await page.goto("/sectors/sec-1");

    await expect(
      page.getByRole("heading", { name: "Chennai South" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(visible(page, "SEC-00001")).toBeVisible();
    await expect(visible(page, "Mylapore East")).toBeVisible();
    await expect(visible(page, "Karthik Rajendran")).toBeVisible();
    await expect(visible(page, "No Senior")).toBeVisible();
    await expect(visible(page, "Besant Nagar Old")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Mylapore East/ }).first(),
    ).toHaveAttribute("href", "/lines/line-7");

    await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Deactivate" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "New line" })).toBeVisible();
  });

  test("a Senior reads the sector but is offered no changes", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", answers([lines[0]]));
    await page.setViewportSize(COMPUTER);
    await page.goto("/sectors/sec-1");

    await expect(
      page.getByRole("heading", { name: "Chennai South" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(visible(page, "Mylapore East")).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "New line" })).toHaveCount(0);
  });

  test("a sector with no lines says so and offers the first", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers([]));
    await page.setViewportSize(COMPUTER);
    await page.goto("/sectors/sec-1");

    await expect(visible(page, "No lines in this sector")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      visible(page, "Add the collection lines that belong to this sector."),
    ).toBeVisible();
  });

  test("a sector outside the caller's access reads as not found", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR");
    await page.setViewportSize(COMPUTER);
    await page.goto("/sectors/sec-9");

    await expect(visible(page, "Sector not found")).toBeVisible({
      timeout: 30_000,
    });
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto("/sectors/sec-1");

      await expect(visible(page, "Adyar Market")).toBeVisible({
        timeout: 30_000,
      });
      expect(await overflows(page), `S-13 at ${name}`).toBe(false);
    });
  }
});
