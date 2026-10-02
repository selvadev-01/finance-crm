import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-011 / M03 — a line's §14 figures on its page, read from the line-wise
 * report for today. **Writes nothing**: every answer is a fixture. The
 * figures are proven at the API (`apps/api/test/reports/`); this proves the
 * line page shows them, and never zeros for what could not be read.
 */

const COMPUTER = { width: 1280, height: 900 };

const row = {
  lineId: "line-7",
  code: "LN-07",
  name: "Market Road",
  isActive: true,
  sectorId: "sec-1",
  sectorCode: "SEC-01",
  sectorName: "Chennai",
  staff: { seniorName: "Karthik R", juniorNames: ["Selvi M"] },
  book: {
    customers: 84,
    accounts: 97,
    activeAccounts: 81,
    completedAccounts: 16,
  },
  amounts: {
    accountAmount: "1940000.00",
    invested: "1649000.00",
    profit: "291000.00",
  },
  collections: {
    expected: "16050.00",
    collected: "15570.00",
    pending: "480.00",
    extra: "0.00",
  },
};

const report = (line: unknown) => ({
  from: "2026-09-23",
  to: "2026-09-23",
  generatedAt: "2026-09-23T10:00:00.000Z",
  lines: [line],
  totals: null,
});

const answers = (line: unknown = row): ApiAnswers => ({
  "/api/lines/line-7": {
    json: {
      id: "line-7",
      sectorId: "sec-1",
      code: "LN-07",
      name: "Market Road",
      isActive: true,
    },
  },
  "/api/sectors/sec-1": {
    json: { id: "sec-1", code: "SEC-01", name: "Chennai", isActive: true },
  },
  "/api/staffing": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/lines/line-7/assignments": {
    json: { data: [], nextCursor: null, hasMore: false },
  },
  "/api/lines/line-7/visiting-order": { json: { customers: [] } },
  "/api/reports/line-wise": { json: report(line) },
});

const figures = (page: Page) =>
  page.getByRole("region", { name: "Collections and money" });

test.describe("a line's figures (US-011, §14)", () => {
  test("shows the line's book, what it was lent on, and today's collection", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers());
    const asked: URL[] = [];
    await page.route("**/api/reports/line-wise**", async (route) => {
      asked.push(new URL(route.request().url()));
      await route.fallback();
    });
    await page.goto("/lines/line-7");

    const section = figures(page);
    await expect(section.getByText("84", { exact: true })).toBeVisible();
    await expect(section.getByText("16 completed")).toBeVisible();
    await expect(section.getByText("₹19,40,000.00")).toBeVisible();
    await expect(section.getByText("₹16,49,000.00")).toBeVisible();
    await expect(section.getByText("₹2,91,000.00 profit")).toBeVisible();
    await expect(section.getByText("₹16,050.00")).toBeVisible();
    await expect(section.getByText("₹480.00")).toBeVisible();
    // Asked for this line only, and one day.
    expect(asked.at(-1)?.searchParams.get("lineId")).toBe("line-7");
    expect(asked.at(-1)?.searchParams.get("from")).toBe(
      asked.at(-1)?.searchParams.get("to"),
    );
    await expect(
      section.getByRole("link", { name: /line-wise report/ }),
    ).toHaveAttribute("href", /\/reports\/line-wise\?line=line-7&from=/);
  });

  test("a group that could not be read is unavailable, never zero", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers({ ...row, amounts: null }));
    await page.goto("/lines/line-7");

    const section = figures(page);
    await expect(section.getByText("84", { exact: true })).toBeVisible();
    await expect(
      section.getByText("Couldn’t be worked out just now").first(),
    ).toBeVisible();
    // Account value and invested are unreadable: shown as unknown, not ₹0.
    await expect(section.getByText("₹19,40,000.00")).toHaveCount(0);
    await expect(section.getByText("₹16,49,000.00")).toHaveCount(0);
    // Today's collection was read, and a real zero stays a zero.
    await expect(section.getByText("₹16,050.00")).toBeVisible();
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto("/lines/line-7");

      await expect(figures(page).getByText("₹16,050.00")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    });
  }
});
