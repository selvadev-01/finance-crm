import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-24, the overdue report (US-087), at the three widths. **Writes nothing**:
 * no sign-in, and every row is a fixture shaped by `reportContract.getOverdue`.
 * The report is the position now, so the fixture's `asOf` is what the screen
 * shows, never today. That the arrears are BR-16's per-day figure is proven at
 * the API (`apps/api/test/reports/`); what is proven here is that the screen
 * draws it as money owed, apart from the outstanding balance.
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

const account = (
  n: number,
  customerName: string,
  daysOverdue: number,
  outstanding: string,
  arrears: string,
  lastCollection: { businessDate: string; amount: string } | null,
) => ({
  accountLoanId: `acc-${n}`,
  accountCode: `ACC-2026-0041${n}`,
  customerId: `cus-${n}`,
  customerName,
  lineId: "line-1",
  lineCode: "LIN-00001",
  lineName: "Mylapore East",
  sectorId: "sec-1",
  sectorName: "Mylapore",
  dailyAmount: "200.00",
  accountAmount: "20000.00",
  outstanding,
  targetCompletionDate: "2026-08-10",
  daysOverdue,
  arrears: {
    amount: arrears,
    unpaidDays: 12,
    lastCollection:
      lastCollection === null ? null : { ...lastCollection, daysAgo: 4 },
  },
});

const rows = [
  account(1, "Meenakshi Sundaram", 44, "4320.00", "2400.00", {
    businessDate: "2026-09-19",
    amount: "200.00",
  }),
  account(2, "Ravi Shankar", 12, "1400.00", "1400.00", null),
  account(3, "Lakshmi Narayanan", 3, "600.00", "400.00", {
    businessDate: "2026-09-22",
    amount: "100.00",
  }),
];

const report = {
  data: rows,
  nextCursor: null,
  hasMore: false,
  asOf: "2026-09-23",
  generatedAt: "2026-09-23T10:00:00.000Z",
  summary: {
    accounts: 3,
    lines: 1,
    outstanding: "6320.00",
    arrears: "4200.00",
    longestOverdue: {
      accountLoanId: "acc-1",
      accountCode: "ACC-2026-00411",
      customerName: "Meenakshi Sundaram",
      daysOverdue: 44,
    },
  },
};

const answers = (body: unknown = report): ApiAnswers => ({
  "/api/reports/overdue": { json: body },
  "/api/sectors": {
    json: {
      data: [
        { id: "sec-1", code: "SEC-00001", name: "Mylapore", isActive: true },
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
});

const PATH = "/reports/overdue";

test.describe("the overdue report (S-24, US-087)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    test(`${role} sees the overdue accounts, longest first, with the set's totals`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role, answers());
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Overdue accounts" }),
      ).toBeVisible();
      await expect(shown(page, "as of 23 Sep 2026")).toBeVisible();

      const totals = page.locator('dl[aria-label="Overdue accounts"]');
      await expect(totals.getByText("₹6,320.00")).toBeVisible();
      await expect(totals.getByText("₹4,200.00")).toBeVisible();
      await expect(totals.getByText("Meenakshi Sundaram")).toBeVisible();

      const table = page.getByRole("table");
      const first = table.getByRole("row", { name: /Meenakshi Sundaram/ });
      await expect(first.getByText("LIN-00001 · Mylapore East")).toBeVisible();
      await expect(first.getByText("44 days")).toBeVisible();
      // Never visited since it went overdue: "Never", not a blank.
      const never = table.getByRole("row", { name: /Ravi Shankar/ });
      await expect(never.getByText("Never")).toBeVisible();
    });
  }

  test("behind is shown as money owed, apart from the outstanding balance", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    const row = page
      .getByRole("table")
      .getByRole("row", { name: /Meenakshi Sundaram/ });
    await expect(row.getByText("₹4,320.00")).toBeVisible();
    await expect(
      row.locator(".text-critical", { hasText: "₹2,400.00" }),
    ).toBeVisible();
  });

  test("a Senior sees their own line's accounts, with no sector or line filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "SENIOR", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(
        page,
        "Your line’s accounts still being collected past their target completion date.",
      ),
    ).toBeVisible();
    await expect(shown(page, "Meenakshi Sundaram")).toBeVisible();
    await expect(page.getByLabel("Sector")).toHaveCount(0);
    // A Senior's own line needs no Line column.
    await expect(page.getByRole("columnheader", { name: "Line" })).toHaveCount(
      0,
    );
  });

  test("with nobody overdue it says so instead of an empty table", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...report,
        data: [],
        summary: {
          accounts: 0,
          lines: 0,
          outstanding: "0.00",
          arrears: "0.00",
          longestOverdue: null,
        },
      }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "Nobody is overdue")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a filter that matches nobody says so, not that nobody is overdue", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...report,
        data: [],
        summary: { ...report.summary, accounts: 0, longestOverdue: null },
      }),
    );
    await page.goto(`${PATH}?overdue=60`);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "Nobody is overdue by that long")).toBeVisible();
  });
});

test.describe("the overdue report at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(shown(page, "Meenakshi Sundaram")).toBeVisible();
      expect(
        await overflows(page),
        `the report scrolls sideways at ${name}`,
      ).toBe(false);
    });
  }
});
