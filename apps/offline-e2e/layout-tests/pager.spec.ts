import { expect, type Page, test } from "@playwright/test";

import { signedInAs, withSavedLayout } from "./fake-api";

/**
 * The console's lists are paged: ten rows at a time, walked over the API's
 * cursors, with the reader told where they are (2026-09-23, replacing the
 * scroll-loading lists of 2026-09-22). Writes nothing.
 *
 * The fake customer book below is what proves it — the page the browser asks
 * for is decided by the `cursor` and `limit` it sends, exactly as the real API
 * decides it, so a wrong cursor shows up here as the wrong rows.
 */

const BOOK = 45;

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

/** The requests the browser made, so the test can read the cursor it sent. */
async function fakeBook(page: Page, asked: URLSearchParams[] = []) {
  await withSavedLayout(page, "desktop");
  await signedInAs(page, "ADMIN", {
    "/api/customers": (url) => {
      asked.push(new URLSearchParams(url.searchParams));
      const limit = Number(url.searchParams.get("limit") ?? 10);
      // The cursor is the 1-based index of the first row of the page, which
      // stands in for the opaque one the API issues.
      const from = Number(url.searchParams.get("cursor") ?? 1);
      const to = Math.min(from + limit - 1, BOOK);
      return {
        json: {
          data: Array.from({ length: Math.max(0, to - from + 1) }, (_, i) =>
            customer(from + i),
          ),
          nextCursor: to < BOOK ? String(to + 1) : null,
          hasMore: to < BOOK,
          total: BOOK,
        },
      };
    },
    "/api/lines": {
      json: { data: [], nextCursor: null, hasMore: false, total: 0 },
    },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  return asked;
}

const row = (page: Page, index: number) =>
  page
    .getByText(`Customer ${index}`, { exact: true })
    .filter({ visible: true });

/**
 * `DataView` draws its footer twice — once in the table it is from 768px, once
 * under the cards it is below that — and CSS shows one of them. Every locator
 * here takes the visible copy.
 */
const shown = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true });
// `exact`, because under `next dev` the dev-tools button is called "Open
// Next.js Dev Tools" and a loose "Next" matches it too.
const control = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });

test("a list opens on its first ten, and says how many there are altogether", async ({
  page,
}) => {
  await fakeBook(page);
  await page.goto("/customers");

  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });
  await expect(row(page, 10)).toBeVisible();
  await expect(row(page, 11)).toHaveCount(0);
  await expect(shown(page, "1–10 of 45 customers")).toBeVisible();
  await expect(shown(page, "Page 1 of 5")).toBeVisible();
  // Nothing to go back to from the first page.
  await expect(control(page, "Previous")).toBeDisabled();
});

test("Next walks the cursor to the following page, and Previous comes back", async ({
  page,
}) => {
  const asked = await fakeBook(page);
  await page.goto("/customers");
  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });

  await control(page, "Next").click();
  await expect(row(page, 11)).toBeVisible();
  await expect(row(page, 10)).toHaveCount(0);
  await expect(shown(page, "11–20 of 45 customers")).toBeVisible();
  await expect(shown(page, "Page 2 of 5")).toBeVisible();
  // The second page was asked for by cursor, not by an offset.
  expect(asked.at(-1)?.get("cursor")).toBe("11");

  await control(page, "Previous").click();
  await expect(row(page, 1)).toBeVisible();
  await expect(shown(page, "1–10 of 45 customers")).toBeVisible();
});

test("the page is in the URL, so a reload opens the same rows", async ({
  page,
}) => {
  await fakeBook(page);
  await page.goto("/customers");
  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });

  await control(page, "Next").click();
  await expect(row(page, 11)).toBeVisible();
  await expect(page).toHaveURL(/[?&]page=2/);

  await page.reload();
  await expect(row(page, 11)).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, "Page 2 of 5")).toBeVisible();
});

test("changing the rows per page starts again at the first page", async ({
  page,
}) => {
  const asked = await fakeBook(page);
  await page.goto("/customers");
  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });
  await control(page, "Next").click();
  await expect(row(page, 11)).toBeVisible();

  await page.getByLabel("Rows").filter({ visible: true }).selectOption("25");

  await expect(row(page, 1)).toBeVisible();
  await expect(row(page, 25)).toBeVisible();
  await expect(shown(page, "1–25 of 45 customers")).toBeVisible();
  await expect(shown(page, "Page 1 of 2")).toBeVisible();
  const last = asked.at(-1);
  expect(last?.get("limit")).toBe("25");
  // The old page's cursor would have been the wrong boundary at a new size.
  expect(last?.get("cursor")).toBeNull();
});

test("a filter sends the reader back to the first page", async ({ page }) => {
  await fakeBook(page);
  await page.goto("/customers");
  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });
  await control(page, "Next").click();
  await expect(shown(page, "Page 2 of 5")).toBeVisible();

  await page.getByRole("searchbox").fill("Customer");

  await expect(shown(page, "Page 1 of 5")).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]page=2/);
});

test("a list that fits on one page shows its count and no pager", async ({
  page,
}) => {
  await withSavedLayout(page, "desktop");
  await signedInAs(page, "ADMIN", {
    "/api/customers": {
      json: {
        data: [customer(1), customer(2)],
        nextCursor: null,
        hasMore: false,
        total: 2,
      },
    },
    "/api/lines": {
      json: { data: [], nextCursor: null, hasMore: false, total: 0 },
    },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/customers");

  await expect(row(page, 1)).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, "2 customers")).toBeVisible();
  await expect(control(page, "Next")).toHaveCount(0);
});
