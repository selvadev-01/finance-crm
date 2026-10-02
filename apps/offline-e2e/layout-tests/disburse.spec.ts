import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs } from "./fake-api";

/**
 * Disbursing a loan (US-032; decided 2026-10-02): only the Super Admin pays
 * money out, and only from cash-in-hand — the dialog shows it now and after,
 * and stops when it is not enough. **Writes nothing**: every answer is a
 * fixture and no disbursement is sent. The refusal itself
 * (`INSUFFICIENT_CASH_IN_HAND`, `PERMISSION_DENIED`) is proven in Tier 1 and
 * the RBAC harness; this proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };

const pending = {
  id: "acc-1",
  accountCode: "ACC-2026-00412",
  customerId: "cus-kumar",
  customerName: "Kumar Traders",
  lineId: "line-7",
  lineName: "Market Road",
  status: "PENDING",
  accountAmount: "10000.00",
  investedAmount: "8500.00",
  profitAmount: "1500.00",
  dailyAmount: "100.00",
  termDays: 100,
  collectionFrequency: "DAILY",
  // Planned for a day already past, so it can be disbursed now.
  disbursementDate: "2026-01-05",
  firstCollectionDate: "2026-01-06",
  targetCompletionDate: "2026-05-01",
  actualCompletionDate: null,
  collectedAmount: "0.00",
  outstandingAmount: "10000.00",
  isOverdue: false,
};

const answers = (officeCash: string): ApiAnswers => ({
  "/api/accounts/acc-1": { json: pending },
  "/api/accounts/acc-1/schedule": { json: { slots: [] } },
  "/api/books/overview": {
    json: {
      asOf: "2026-09-24",
      officeCash,
      banks: [],
      month: {
        from: "2026-09-01",
        expenses: "0.00",
        otherIncome: "0.00",
        drawings: "0.00",
        capital: "0.00",
        pendingFieldExpenses: 0,
      },
    },
  },
});

test.describe("disbursing from cash-in-hand (US-032)", () => {
  test("the Super Admin sees cash-in-hand now and after the loan, and may disburse", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("20000.00"));
    await page.goto("/accounts/acc-1");

    await page.getByRole("button", { name: "Disburse", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Disburse ACC-2026-00412",
    });
    const cash = dialog.getByRole("definition");
    await expect(cash.getByText("₹20,000.00")).toBeVisible();
    // 20,000 less the 8,500 paid out.
    await expect(cash.getByText("₹11,500.00")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Disburse ACC-2026-00412" }),
    ).toBeEnabled();
  });

  test("not enough cash-in-hand stops the loan and offers to add capital", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("5000.00"));
    await page.goto("/accounts/acc-1");

    await page.getByRole("button", { name: "Disburse", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Disburse ACC-2026-00412",
    });
    await expect(dialog.getByText("−₹3,500.00")).toBeVisible();
    await expect(
      dialog.getByText("Not enough cash in hand", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Disburse ACC-2026-00412" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("link", { name: "Add money" }),
    ).toHaveAttribute("href", "/books/money?action=capital");
  });

  test("an Admin is not offered to disburse — the account waits for the Super Admin", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers("20000.00"));
    await page.goto("/accounts/acc-1");

    await expect(
      page.getByText("Waiting for the Super Admin to disburse"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disburse", exact: true }),
    ).toHaveCount(0);
    // Terms are still the Admin's to correct before then.
    await expect(
      page.getByRole("button", { name: "Correct terms" }),
    ).toBeVisible();
  });
});
