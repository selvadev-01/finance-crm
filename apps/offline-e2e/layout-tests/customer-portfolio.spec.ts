import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-09p — Customer 360's portfolio (2026-09-22) for the console roles. Writes
 * nothing: every `/api/…` request is answered in the browser. That a Junior's
 * overview carries no invested amount or profit, and the figures' sums, are
 * proven in `apps/api/test/customers/customer-overview.service.spec.ts`.
 */

const detail = {
  id: "cus-ravi",
  customerCode: "CUS-00587",
  name: "Ravi Shankar",
  mobile: "+919842155013",
  status: "ACTIVE",
  lineId: "line-7",
  lineName: "Market Road",
  sectorId: "sec-1",
  alternateMobile: null,
  address: "3/7 Market Road, Ward 4",
  notes: null,
  sectorName: "Chennai",
  references: [],
};

const loan = (
  id: string,
  accountCode: string,
  accountAmount: string,
  collectedAmount: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  accountCode,
  customerId: "cus-ravi",
  customerName: "Ravi Shankar",
  lineId: "line-7",
  lineName: "Market Road",
  status: "ACTIVE",
  accountAmount,
  investedAmount: "10000.00",
  profitAmount: "2000.00",
  dailyAmount: "400.00",
  termDays: 30,
  disbursementDate: "2026-08-20",
  firstCollectionDate: "2026-08-21",
  targetCompletionDate: "2026-09-27",
  actualCompletionDate: null,
  collectedAmount,
  outstandingAmount: "2400.00",
  isOverdue: false,
  ...overrides,
});

const answers: ApiAnswers = {
  "/api/customers/cus-ravi": { json: detail },
  "/api/customers/cus-ravi/line-transfers": { json: { data: [] } },
  "/api/customers/cus-ravi/overview": {
    json: {
      accounts: { active: 2, completed: 1, other: 0 },
      outstandingTotal: "4700.00",
      collectedTotal: "22300.00",
      overdueAccounts: 1,
      missedDays: 2,
      lastPaidOn: "2026-09-20",
      investedTotal: "28500.00",
      profitTotal: "3150.00",
      staff: { seniorName: "Murugan", juniorNames: ["Karthik"] },
    },
  },
  "/api/accounts": {
    json: {
      data: [
        loan("acc-2", "ACC-2026-0114", "12000.00", "9600.00"),
        loan("acc-3", "ACC-2026-0152", "5000.00", "2700.00", {
          isOverdue: true,
        }),
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/customers/cus-ravi/collections": {
    json: { data: [], nextCursor: null, hasMore: false },
  },
};

for (const [who, role, layout, viewport] of [
  ["an Admin on a computer", "ADMIN", "desktop", { width: 1280, height: 900 }],
  ["a Senior on a phone", "SENIOR", "mobile", { width: 360, height: 780 }],
] as const) {
  test(`Customer 360 opens on the portfolio — ${who}`, async ({ page }) => {
    await withSavedLayout(page, layout);
    await signedInAs(page, role, answers);
    await page.setViewportSize(viewport);
    await page.goto("/customers/cus-ravi");

    await expect(
      page.getByRole("tab", { name: "Portfolio", selected: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Outstanding across 2 active accounts"),
    ).toBeVisible();
    await expect(page.getByText("₹28,500.00")).toBeVisible();
    await expect(page.getByText("Profit on these accounts")).toBeVisible();
    await expect(
      page.getByText(
        "1 account is past its target date with money still owed.",
      ),
    ).toBeVisible();
    const accounts = page.getByTestId("portfolio-accounts");
    await expect(accounts).toContainText("ACC-2026-0114");
    await expect(accounts).toContainText("80.0%");
    await expect(accounts).toContainText("Active · overdue");

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows, `Customer 360 scrolls sideways — ${who}`).toBe(false);
  });
}
