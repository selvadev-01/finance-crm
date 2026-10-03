import { expect, test } from "@playwright/test";

import { BOOKS_SIMPLE } from "../../web/lib/books-mode";
import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * "Cash & customer dues" on the Ledger's summary (`/books`), in a real browser:
 * cash and what customers owe, account by account, from the trial balance.
 * **Writes nothing**: every answer is a fixture. The balances themselves are
 * proven in `apps/api/test/ledger/`; this proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };
const TODAY = "2026-09-24";

const row = (
  accountType: string,
  debits: string,
  credits: string,
  extra: Record<string, unknown> = {},
) => ({
  accountType,
  ownerUserId: null,
  ownerName: null,
  referenceId: null,
  referenceName: null,
  accounts: 1,
  ledgerAccountId: `la-${accountType}`,
  debits,
  credits,
  debitBalance: "0.00",
  creditBalance: "0.00",
  ...extra,
});

const answers: ApiAnswers = {
  "/api/books/overview": {
    json: {
      asOf: TODAY,
      officeCash: "83300.00",
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
  "/api/ledger/trial-balance": {
    json: {
      asOf: TODAY,
      generatedAt: "2026-09-24T10:00:00.000Z",
      rows: [
        row("CASH_AT_OFFICE", "125200.00", "41900.00"),
        row("CASH_IN_HAND", "3300.00", "3200.00", {
          ownerUserId: "user-selvi",
          ownerName: "Selvi M",
          ledgerAccountId: "la-selvi",
        }),
        row("LOAN_RECEIVABLE", "2200.00", "300.00", {
          accounts: 12,
          ledgerAccountId: null,
        }),
        row("CAPITAL", "0.00", "150000.00"),
        row("EXPENSE", "1200.00", "0.00", { referenceName: "Rent" }),
      ],
      totals: { debitBalance: "0.00", creditBalance: "0.00" },
      balanced: true,
    },
  },
};

const section = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Cash, customer dues and latest entries" });

test.describe("cash and customer dues, on the ledger summary", () => {
  test.beforeEach(() => {
    test.skip(!BOOKS_SIMPLE, "Simple Books is off");
  });

  test("lists cash account by account, in plain words, with each one's entries", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/books");

    const money = section(page);
    await expect(
      money.getByText("Cash at office").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money.getByText("With staff · Selvi M").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money.getByText("₹1,25,200.00").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money.getByText("₹83,300.00").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money
        .getByRole("link", { name: "View entries ›" })
        .filter({ visible: true })
        .first(),
    ).toHaveAttribute("href", /^\/books\/statements\/la-CASH_AT_OFFICE\?from=/);
    await expect(money.getByText(/debit|credit/i)).toHaveCount(0);
  });

  test("shows only cash and what customers owe — the other tabs keep the rest", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/books");

    const money = section(page);
    await expect(money.getByRole("tab")).toHaveText([
      "Cash",
      "Customer dues",
      "Latest entries",
    ]);
    await expect(money.getByText("Money added by owner")).toHaveCount(0);
    await expect(money.getByText(/Rent/)).toHaveCount(0);

    await money.getByRole("tab", { name: "Customer dues" }).click();
    await expect(
      money
        .getByText("Customer loans · 12 loans")
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      money.getByText("Still owed").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money.getByText("₹1,900.00").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      money.getByText("On each loan's page").filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test("fits a phone without sideways scrolling", async ({ page }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", answers);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/books");

    await expect(
      section(page).getByText("Cash at office").filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
});
