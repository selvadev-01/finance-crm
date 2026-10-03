import { expect, type Page, test } from "@playwright/test";

import { BOOKS_SIMPLE } from "../../web/lib/books-mode";
import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/** Why a test of a screen hidden in simple Books skips (lib/books-mode.ts). */
const HIDDEN = "Hidden in simple Books; kept for when BOOKS_SIMPLE is off";

/**
 * Books slice 4 (ADR-0018): profit and loss, the balance sheet, the cash book
 * and an account statement, in a real browser. **Writes nothing**: every
 * answer is a fixture — the worked example of
 * `apps/api/test/books/statements.service.spec.ts` as the API returns it. The
 * figures are proven there; who may read them, in the RBAC harness.
 */

const COMPUTER = { width: 1280, height: 900 };
const MONDAY = "2026-01-05";

const pnl = {
  from: "2026-01-01",
  to: MONDAY,
  generatedAt: "2026-01-05T14:30:00.000Z",
  income: { earnedProfit: "15.00", otherIncome: "200.00", total: "215.00" },
  expenses: {
    categories: [{ categoryId: "cat-rent", name: "Rent", amount: "3000.00" }],
    writeOffLoss: "0.00",
    total: "3000.00",
  },
  netProfit: "-2785.00",
};

const sheet = {
  asOf: MONDAY,
  generatedAt: "2026-01-05T14:30:00.000Z",
  assets: {
    officeCash: "-500.00",
    banks: [{ id: "bank-sbi", name: "SBI Mylapore", balance: "5000.00" }],
    cashWithStaff: [{ id: "user-selvi", name: "Selvi M", balance: "100.00" }],
    loansReceivable: "1900.00",
    unearnedProfit: "285.00",
    total: "6215.00",
  },
  equity: {
    capital: "10000.00",
    drawings: "1000.00",
    retainedProfit: "-2785.00",
    total: "6215.00",
  },
  balanced: true,
};

const entry = (
  id: string,
  description: string,
  debit: string,
  credit: string,
  balance: string,
  transactionType = "EXPENSE",
) => ({
  ledgerTransactionId: id,
  businessDate: MONDAY,
  transactionType,
  description,
  debit,
  credit,
  balance,
});

const book = {
  account: {
    ledgerAccountId: "la-office",
    accountType: "CASH_AT_OFFICE",
    name: "Cash-in-hand",
    normalBalance: "DEBIT",
  },
  from: MONDAY,
  to: MONDAY,
  generatedAt: "2026-01-05T14:30:00.000Z",
  opening: "-1700.00",
  entries: [
    entry("tx-1", "Opening capital", "10000.00", "0.00", "8300.00", "CAPITAL"),
    entry("tx-2", "Rent: January rent", "0.00", "3000.00", "5300.00"),
  ],
  totals: { debits: "10000.00", credits: "3000.00" },
  closing: "5300.00",
};

const banks = [
  {
    id: "bank-sbi",
    name: "SBI Mylapore",
    last4: "4321",
    isActive: true,
    balance: "5000.00",
  },
];

const answers: ApiAnswers = {
  "/api/books/profit-and-loss": { json: pnl },
  "/api/books/balance-sheet": { json: sheet },
  "/api/books/cash-book": { json: book },
  "/api/bank-accounts": { json: { data: banks } },
  "/api/ledger/accounts/la-capital/statement": {
    json: {
      ...book,
      account: {
        ledgerAccountId: "la-capital",
        accountType: "CAPITAL",
        name: "Capital",
        normalBalance: "CREDIT",
      },
      opening: "0.00",
      entries: [
        entry(
          "tx-1",
          "Opening capital",
          "0.00",
          "10000.00",
          "10000.00",
          "CAPITAL",
        ),
      ],
      totals: { debits: "0.00", credits: "10000.00" },
      closing: "10000.00",
    },
  },
};

const shown = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).filter({ visible: true }).first();

test.describe("statements (ADR-0018)", () => {
  test("profit and loss reads income, expenses by category, and a loss in its own word", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto(`/books/profit-and-loss?from=2026-01-01&to=${MONDAY}`);

    await expect(
      page.getByRole("heading", { name: "Profit & loss" }),
    ).toBeVisible();
    // The answer first.
    const result = page.getByRole("region", { name: "Result" });
    await expect(result.getByText("Net loss", { exact: false })).toBeVisible();
    await expect(result.getByText("−₹2,785.00").first()).toBeVisible();
    const income = page.getByRole("region", { name: "Income" });
    await expect(
      income.getByText("Earned profit", { exact: true }),
    ).toBeVisible();
    await expect(income.getByText("₹215.00")).toBeVisible();
    const expenses = page.getByRole("region", { name: "Expenses" });
    await expect(
      expenses
        .getByRole("list", { name: "Expenses by type" })
        .getByText("Rent"),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Last 6 months" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  test("the balance sheet's two sides agree, with deductions in brackets", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto(`/books/balance-sheet?date=${MONDAY}`);

    await expect(
      page.getByRole("status").getByText("Both sides agree", { exact: false }),
    ).toBeVisible();
    const assets = page.getByRole("region", { name: "Assets" });
    await expect(assets.getByText("−₹500.00")).toBeVisible();
    await expect(assets.getByText("Cash with Selvi M")).toBeVisible();
    await expect(assets.getByText("Less: Unearned profit")).toBeVisible();
    await expect(assets.getByText("(₹285.00)")).toBeVisible();
    await expect(assets.getByText("₹6,215.00")).toBeVisible();
    const equity = page.getByRole("region", { name: "Capital & liabilities" });
    await expect(equity.getByText("(₹1,000.00)")).toBeVisible();
    await expect(equity.getByText("₹6,215.00")).toBeVisible();
  });

  test("an unbalanced sheet says it is a fault, not a figure", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", {
      ...answers,
      "/api/books/balance-sheet": { json: { ...sheet, balanced: false } },
    });
    await page.goto("/books/balance-sheet");
    await expect(
      page.getByText("The two sides do not agree.", { exact: false }),
    ).toBeVisible();
  });

  test("the cash book opens on office cash, switches to a bank, and runs its balance", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    const asked: string[] = [];
    await signedInAs(page, "ADMIN", answers);
    page.on("request", (request) => {
      if (request.url().includes("/api/books/cash-book"))
        asked.push(request.url());
    });
    await page.goto(`/books/cash-book?from=${MONDAY}&to=${MONDAY}`);

    await expect(shown(page, "−₹1,700.00")).toBeVisible();
    await expect(shown(page, "₹5,300.00")).toBeVisible();
    await expect(shown(page, "Rent: January rent")).toBeVisible();
    // Grouped by day, with the day's net change.
    await expect(shown(page, "+₹7,000.00")).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Cash / bank book" })
      .getByRole("radio", { name: /SBI Mylapore/ })
      .click();
    await expect
      .poll(() => asked.some((url) => url.includes("bankAccountId=bank-sbi")))
      .toBe(true);
  });

  test("a trial balance row opens its account's statement", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", {
      ...answers,
      "/api/ledger/trial-balance": {
        json: {
          asOf: MONDAY,
          generatedAt: "2026-01-05T14:30:00.000Z",
          rows: [
            {
              accountType: "CAPITAL",
              ownerUserId: null,
              ownerName: null,
              referenceId: null,
              referenceName: null,
              accounts: 1,
              ledgerAccountId: "la-capital",
              debits: "0.00",
              credits: "10000.00",
              debitBalance: "0.00",
              creditBalance: "10000.00",
            },
          ],
          totals: { debitBalance: "0.00", creditBalance: "10000.00" },
          balanced: false,
        },
      },
    });
    await page.goto(`/reports/trial-balance?date=${MONDAY}`);
    await page
      .getByRole("link", { name: "Capital" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Capital" })).toBeVisible();
    await expect(shown(page, "₹10,000.00")).toBeVisible();
  });

  test("a Senior is refused the statements", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers);
    await page.goto("/books/profit-and-loss");
    await expect(
      page.getByText("The ledger is for Super Admins and Admins."),
    ).toBeVisible();
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`every statement fits a ${name}`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "SUPER_ADMIN", answers);
      await page.setViewportSize(viewport);
      for (const [path, text] of [
        ["/books/profit-and-loss", "Total income"],
        ...(BOOKS_SIMPLE
          ? []
          : ([
              ["/books/balance-sheet", "Reserves & surplus"],
              ["/books/cash-book", "Rent: January rent"],
            ] as const)),
        ["/books/statements/la-capital", "Opening capital"],
      ] as const) {
        await page.goto(path);
        await expect(
          page.getByText(text).filter({ visible: true }).first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          `${path} at ${name}`,
        ).toBe(false);
      }
    });
  }
});
