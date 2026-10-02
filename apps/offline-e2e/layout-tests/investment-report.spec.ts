import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-26, the investment overview (US-085, PDF §22), at the three widths.
 * **Writes nothing**: no sign-in, and every figure is a fixture shaped by
 * `reportContract.getInvestment`. That the ledger reads are right is proven at
 * the API (`apps/api/test/reports/`); what is proven here is that the screen
 * draws contracted against actual, and keeps the period's own figures apart —
 * including a period whose corrections took money back, which is negative.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const mylapore = {
  lineId: "line-1",
  code: "LIN-00001",
  name: "Mylapore East",
  isActive: true,
  sectorId: "sec-1",
  sectorCode: "SEC-00001",
  sectorName: "Mylapore",
  position: {
    accounts: 97,
    accountAmount: "1940000.00",
    invested: "1649000.00",
    profit: "291000.00",
    outstanding: "812400.00",
    returned: "1127600.00",
    profitEarned: "169140.00",
    profitToEarn: "121860.00",
  },
  range: {
    disbursements: 6,
    accountAmount: "120000.00",
    invested: "102000.00",
    profit: "18000.00",
    returned: "108030.00",
    profitEarned: "16204.50",
  },
};

/** An inactive line still carrying an investment. */
const triplicane = {
  ...mylapore,
  lineId: "line-2",
  code: "LIN-00002",
  name: "Triplicane High Road",
  isActive: false,
  sectorId: "sec-2",
  sectorCode: "SEC-00002",
  sectorName: "Triplicane",
  position: {
    accounts: 12,
    accountAmount: "240000.00",
    invested: "204000.00",
    profit: "36000.00",
    outstanding: "18200.00",
    returned: "221800.00",
    profitEarned: "33270.00",
    profitToEarn: "2730.00",
  },
  range: {
    disbursements: 0,
    accountAmount: "0.00",
    invested: "0.00",
    profit: "0.00",
    returned: "-200.00",
    profitEarned: "-30.00",
  },
};

const report = {
  from: "2026-09-01",
  to: "2026-09-23",
  generatedAt: "2026-09-23T10:00:00.000Z",
  lines: [mylapore, triplicane],
  totals: {
    lines: 2,
    position: {
      accounts: 109,
      accountAmount: "2180000.00",
      invested: "1853000.00",
      profit: "327000.00",
      outstanding: "830600.00",
      returned: "1349400.00",
      profitEarned: "202410.00",
      profitToEarn: "124590.00",
    },
    range: {
      disbursements: 6,
      accountAmount: "120000.00",
      invested: "102000.00",
      profit: "18000.00",
      returned: "107830.00",
      profitEarned: "16174.50",
    },
  },
};

const answers = (body: unknown = report): ApiAnswers => ({
  "/api/reports/investment": { json: body },
  "/api/sectors": {
    json: {
      data: [
        { id: "sec-1", code: "SEC-00001", name: "Mylapore", isActive: true },
        { id: "sec-2", code: "SEC-00002", name: "Triplicane", isActive: true },
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
});

/** An explicit range, so the screen never depends on today's date. */
const PATH = "/reports/investment?from=2026-09-01&to=2026-09-23";

test.describe("the investment overview (S-26, US-085)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    test(`${role} sees each line's investment, contracted against the ledger`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role, answers());
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Investment overview" }),
      ).toBeVisible();
      await expect(shown(page, "Mylapore East")).toBeVisible();
      await expect(shown(page, "Triplicane High Road")).toBeVisible();

      const row = page
        .getByRole("table")
        .getByRole("row", { name: /Mylapore East/ });
      await expect(row.getByText("₹16,49,000.00")).toBeVisible();
      await expect(row.getByText("₹8,12,400.00")).toBeVisible();

      const totals = page.locator('dl[aria-label="This period"]');
      await expect(totals.getByText("₹1,02,000.00")).toBeVisible();
      await expect(totals.getByText("₹16,174.50")).toBeVisible();
    });
  }

  test("a period whose corrections took money back shows it negative, not as a positive amount", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    // `range.profitEarned` is signed (US-044): ₹30 of profit reversed on the
    // inactive line, shown with its sign rather than as ₹30.00.
    const row = page
      .getByRole("table")
      .getByRole("row", { name: /Triplicane High Road/ });
    await expect(row.getByText(/[-−]₹30\.00/)).toBeVisible();
  });

  test("a Senior sees their own line, with no sector or line filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "SENIOR", answers({ ...report, lines: [mylapore] }));
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, "What your line was lent, and what has come back."),
    ).toBeVisible();
    await expect(shown(page, "Mylapore East")).toBeVisible();
    await expect(page.getByLabel("Sector")).toHaveCount(0);
  });

  test("with no lines yet it says so instead of an empty table", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({ ...report, lines: [], totals: null }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "No lines yet")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a ledger that could not be read is said so, never shown as zeros", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...report,
        lines: report.lines.map((line) => ({ ...line, position: null })),
        totals: { ...report.totals, position: null },
      }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, /Couldn’t work out the standing investment just now/),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Still out" }),
    ).toHaveCount(0);
  });
});

test.describe("the investment overview at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(shown(page, "Mylapore East")).toBeVisible();
      expect(
        await overflows(page),
        `the report scrolls sideways at ${name}`,
      ).toBe(false);
    });
  }
});
