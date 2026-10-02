import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-16 — the collection list (US-045) in a real browser. Writes nothing:
 * every `/api/…` request is answered here. Which rows a caller may read is
 * proven over HTTP (`apps/api/test`); this proves what the screen makes of
 * them — originals as recorded, corrections as a signed change.
 */

const RANGE = "from=2026-09-17&to=2026-09-23";

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "col-1",
  entryType: "ORIGINAL",
  status: "CONFIRMED",
  adjustsCollectionId: null,
  accountLoanId: "acc-1",
  accountCode: "ACC-2026-00412",
  customerId: "cus-1",
  customerName: "Meenakshi Sundaram",
  lineId: "line-7",
  lineName: "Mylapore East",
  collectedByUserId: "user-junior",
  collectedByName: "Selvi M",
  businessDate: "2026-09-23",
  capturedAt: "2026-09-23T05:10:00.000Z",
  syncedAt: "2026-09-23T05:10:04.000Z",
  expectedAmount: "4320.00",
  amount: "4320.00",
  variance: "0.00",
  classification: "CORRECT",
  note: null,
  ...overrides,
});

const rows = [
  entry(),
  entry({
    id: "col-2",
    accountLoanId: "acc-2",
    accountCode: "ACC-2026-00418",
    customerId: "cus-2",
    customerName: "Parvathi Ramasamy",
    businessDate: "2026-09-22",
    expectedAmount: "500.00",
    amount: "400.00",
    variance: "-100.00",
    classification: "LOW",
  }),
  entry({
    id: "col-3",
    entryType: "ADJUSTMENT",
    status: "CONFIRMED",
    adjustsCollectionId: "col-1",
    expectedAmount: "0.00",
    amount: "-20.00",
    variance: "0.00",
    classification: "LOW",
  }),
];

const page$ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

const lines = page$([
  {
    id: "line-7",
    sectorId: "sec-1",
    code: "LN-07",
    name: "Mylapore East",
    isActive: true,
  },
]);

function answers(data: unknown[]): ApiAnswers {
  return { "/api/collections": page$(data), "/api/lines": lines };
}

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("the collection list (S-16)", () => {
  for (const [who, role] of [
    ["an Admin", "ADMIN"],
    ["a Senior", "SENIOR"],
  ] as const) {
    test(`shows originals as recorded and corrections signed — ${who}`, async ({
      page,
    }) => {
      await withSavedLayout(page, "desktop");
      await signedInAs(page, role, answers(rows));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/collections?${RANGE}`);

      await expect(visible(page, "Parvathi Ramasamy")).toBeVisible({
        timeout: 30_000,
      });
      await expect(visible(page, "Meenakshi Sundaram")).toBeVisible();
      await expect(visible(page, "₹4,320.00")).toBeVisible();
      await expect(visible(page, "−₹20.00")).toBeVisible();
      await expect(page.getByLabel("From")).toHaveValue("2026-09-17");
      await expect(page.getByLabel("To", { exact: true })).toHaveValue(
        "2026-09-23",
      );
      // Both may approve corrections, so both are offered the queue.
      await expect(
        page.getByRole("link", { name: "Pending approvals" }),
      ).toBeVisible();
    });
  }

  test("a correction links to the collection it corrects", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers([rows[2]]));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/collections?${RANGE}`);

    const link = page
      .getByRole("link", { name: /Meenakshi Sundaram/ })
      .filter({ visible: true })
      .first();
    await expect(link).toHaveAttribute("href", "/collections/col-1");
  });

  test("says so when no collection falls in the dates", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers([]));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/collections?${RANGE}`);

    await expect(visible(page, "No collections in these dates")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a range the other way round asks for a valid one", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers(rows));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/collections?from=2026-09-23&to=2026-09-17");

    await expect(
      visible(page, "“From” must be on or before “To”, within 93 days."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Show today" }),
    ).toBeVisible();
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers(rows));
      await page.setViewportSize(viewport);
      await page.goto(`/collections?${RANGE}`);

      await expect(visible(page, "Parvathi Ramasamy")).toBeVisible({
        timeout: 30_000,
      });
      expect(await overflows(page), `S-16 at ${name}`).toBe(false);
    });
  }
});
