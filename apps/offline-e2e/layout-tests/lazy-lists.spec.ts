import { expect, test } from "@playwright/test";

import { signedInAs, withSavedLayout } from "./fake-api";

/**
 * The console's paged lists load their next page by themselves as the reader
 * scrolls near the end (2026-09-22), in the one page scroll — the footer's
 * lazy marker — and keep "Show more" for the keyboard. Writes nothing.
 */

const customer = (index: number) => ({
  id: `cus-${index}`,
  customerCode: `CUS-${String(index).padStart(5, "0")}`,
  name: `Customer ${index}`,
  mobile: "+919842155000",
  status: "ACTIVE",
  lineId: "line-7",
  lineName: "Market Road",
  sectorId: "sec-1",
});

test("the customer list loads its next page as it scrolls, without a tap", async ({
  page,
}) => {
  const pages: string[] = [];
  await withSavedLayout(page, "desktop");
  await signedInAs(page, "ADMIN", {
    "/api/customers": (url) => {
      const cursor = url.searchParams.get("cursor");
      pages.push(cursor ?? "first");
      const start = cursor ? 26 : 1;
      return {
        json: {
          data: Array.from({ length: 25 }, (_, i) => customer(start + i)),
          nextCursor: cursor ? null : "page-2",
          hasMore: !cursor,
        },
      };
    },
    "/api/lines": {
      json: { data: [], nextCursor: null, hasMore: false },
    },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/customers");

  const row = (index: number) =>
    page
      .getByText(`Customer ${index}`, { exact: true })
      .filter({ visible: true });
  await expect(row(25)).toBeVisible({ timeout: 30_000 });
  await expect(row(26)).toHaveCount(0);

  await row(25).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 4000);
  await expect(row(50)).toBeVisible();
  // The marker asked for the next page once. (The first page may be read
  // twice under `next dev`, where React runs effects twice.)
  expect(pages.filter((cursor) => cursor === "page-2")).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
});
