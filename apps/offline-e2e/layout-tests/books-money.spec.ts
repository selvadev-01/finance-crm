import { expect, type Page, test } from "@playwright/test";

import { BOOKS_SIMPLE } from "../../web/lib/books-mode";
import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/** Why a test of a screen hidden in simple Books skips (lib/books-mode.ts). */
const HIDDEN = "Hidden in simple Books; kept for when BOOKS_SIMPLE is off";

/**
 * Books slice 2 (ADR-0018): the Books overview, the expenses list and the
 * bank / income / drawings page, in a real browser. **Writes nothing**: every
 * answer is a fixture and every write is captured and answered here. The
 * postings and their maths are proven in `apps/api/test/books/`, who may
 * record what in the RBAC harness.
 */

const COMPUTER = { width: 1280, height: 900 };

const categories = [
  { id: "cat-rent", name: "Rent", isActive: true },
  { id: "cat-old", name: "Courier", isActive: false },
];

const banks = [
  {
    id: "bank-sbi",
    name: "SBI Mylapore",
    last4: "4321",
    isActive: true,
    balance: "4500.00",
  },
];

const admin = { userId: "user-admin", name: "Lakshmi" };

const rent = {
  id: "exp-rent",
  category: { id: "cat-rent", name: "Rent" },
  amount: "3000.00",
  businessDate: "2026-09-01",
  note: "September rent",
  paidFrom: "OFFICE_CASH",
  from: { bankAccountId: null, name: "Cash-in-hand" },
  spender: null,
  line: null,
  status: "APPROVED",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  recordedBy: admin,
  createdAt: "2026-09-01T05:00:00.000Z",
  canDecide: false,
};

const petrol = {
  ...rent,
  id: "exp-petrol",
  category: { id: "cat-fuel", name: "Fuel & travel" },
  amount: "50.00",
  note: "Petrol for the round",
  paidFrom: "CASH_IN_HAND",
  from: { bankAccountId: null, name: "Ravi's cash" },
  spender: { userId: "user-ravi", name: "Ravi" },
  line: { id: "line-1", name: "Mylapore A" },
  status: "PENDING",
  recordedBy: { userId: "user-ravi", name: "Ravi" },
};

const deposit = {
  id: "mv-1",
  amount: "5000.00",
  businessDate: "2026-09-02",
  note: "Deposit of Monday's collections",
  from: { bankAccountId: null, name: "Cash-in-hand" },
  to: { bankAccountId: "bank-sbi", name: "SBI Mylapore" },
  recordedBy: admin,
  createdAt: "2026-09-02T05:00:00.000Z",
};

const paged = <Row>(data: Row[], extra: object) => ({
  json: {
    data,
    nextCursor: null,
    hasMore: false,
    total: data.length,
    ...extra,
  },
});

const answers: ApiAnswers = {
  "/api/expense-categories": { json: { data: categories } },
  "/api/bank-accounts": { json: { data: banks } },
  "/api/books/overview": {
    json: {
      asOf: "2026-09-24",
      officeCash: "-1200.00",
      banks: [
        {
          bankAccountId: "bank-sbi",
          name: "SBI Mylapore",
          last4: "4321",
          balance: "4500.00",
        },
      ],
      month: {
        from: "2026-09-01",
        expenses: "3500.00",
        otherIncome: "200.00",
        drawings: "1000.00",
        capital: "10000.00",
        pendingFieldExpenses: 1,
      },
    },
  },
  "/api/expenses": paged([rent, petrol], { approvedTotal: "3000.00" }),
  "/api/bank-transfers": paged([deposit], { amountTotal: "5000.00" }),
  "/api/other-income": paged([], { amountTotal: "0.00" }),
  "/api/drawings": paged([], { amountTotal: "0.00" }),
  // The overview and the expenses page read the month's statements too.
  "/api/books/profit-and-loss": {
    json: {
      from: "2026-09-01",
      to: "2026-09-24",
      generatedAt: "2026-09-24T10:00:00.000Z",
      income: { earnedProfit: "15.00", otherIncome: "200.00", total: "215.00" },
      expenses: {
        categories: [
          { categoryId: "cat-rent", name: "Rent", amount: "3000.00" },
        ],
        writeOffLoss: "0.00",
        total: "3000.00",
      },
      netProfit: "-2785.00",
    },
  },
  "/api/books/balance-sheet": {
    json: {
      asOf: "2026-09-24",
      generatedAt: "2026-09-24T10:00:00.000Z",
      assets: {
        officeCash: "-1200.00",
        banks: [{ id: "bank-sbi", name: "SBI Mylapore", balance: "4500.00" }],
        cashWithStaff: [{ id: "user-ravi", name: "Ravi", balance: "100.00" }],
        loansReceivable: "1900.00",
        unearnedProfit: "285.00",
        total: "5015.00",
      },
      equity: {
        capital: "10000.00",
        drawings: "1000.00",
        retainedProfit: "-3985.00",
        total: "5015.00",
      },
      balanced: true,
    },
  },
  "/api/ledger/transactions": paged(
    [
      {
        id: "tx-1",
        transactionType: "EXPENSE",
        businessDate: "2026-09-24",
        eventAt: "2026-09-24T10:00:00.000Z",
        description: "Rent: September rent",
        sourceTable: "expense",
        sourceId: "exp-rent",
        createdByName: "Lakshmi",
        entries: [],
        amount: "3000.00",
      },
    ],
    {},
  ),
};

/** Captures the writes to a path, answering each with `reply`. */
async function capture(page: Page, pattern: string, reply: unknown) {
  const sent: unknown[] = [];
  await page.route(pattern, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: reply });
  });
  return sent;
}

test.describe("books (ADR-0018)", () => {
  test("simple Books: four numbers, the buttons, what is waiting, and the latest entries", async ({
    page,
  }) => {
    test.skip(!BOOKS_SIMPLE, "Simple Books is off");
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    await page.goto("/books");

    await expect(page.getByRole("heading", { name: "Money" })).toBeVisible();
    const today = page.getByRole("definition");
    await expect(today.getByText("−₹1,200.00")).toBeVisible();
    await expect(today.getByText("₹100.00")).toBeVisible();
    await expect(today.getByText("₹1,900.00")).toBeVisible();
    await expect(today.getByText("−₹2,785.00")).toBeVisible();
    await expect(
      page.getByText("1 staff expense is waiting for approval."),
    ).toBeVisible();
    await expect(
      page.getByText("Cash in hand is below zero", { exact: false }),
    ).toBeVisible();
    const actions = page.getByRole("list", { name: "Actions" });
    for (const name of [
      "Add money",
      "Add expense",
      "Other income",
      "Owner took money",
    ]) {
      await expect(actions.getByRole("link", { name })).toBeVisible();
    }
    // No bank anywhere.
    await expect(page.getByText("SBI Mylapore")).toHaveCount(0);
    await expect(
      page
        .getByRole("list", { name: "Latest entries" })
        .getByText("Rent: September rent", { exact: false }),
    ).toBeVisible();
  });

  test("an Admin sees no Add money or Owner took money — those are the owner's", async ({
    page,
  }) => {
    test.skip(!BOOKS_SIMPLE, "Simple Books is off");
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/books");
    const actions = page.getByRole("list", { name: "Actions" });
    await expect(actions.getByRole("link")).toHaveCount(2);
    await expect(actions.getByRole("link", { name: "Add money" })).toHaveCount(
      0,
    );
  });

  test("an Admin records an expense from cash in hand, with nothing to choose", async ({
    page,
  }) => {
    test.skip(!BOOKS_SIMPLE, "Simple Books is off");
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    const sent = await capture(page, "**/api/expenses**", {
      ...rent,
      id: "exp-new",
      amount: "500.00",
      note: "Broadband",
    });
    await page.goto("/books/expenses");

    await page.getByRole("button", { name: "Record expense" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record expense" });
    await dialog
      .getByRole("radiogroup", { name: "Expense type" })
      .getByRole("radio", { name: "Rent" })
      .click();
    await dialog.getByLabel("Amount (₹)").fill("500");
    await expect(
      dialog.getByRole("radiogroup", { name: "Paid from" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Cash in hand −₹1,200.00 → −₹1,700.00 after this"),
    ).toBeVisible();
    await dialog.getByLabel("Note").fill("Broadband");
    await dialog.getByRole("button", { name: "Record ₹500.00" }).click();
    await expect(dialog).toBeHidden();
    expect(sent.at(-1)).toEqual({
      categoryId: "cat-rent",
      amount: "500",
      note: "Broadband",
      paidFrom: "OFFICE_CASH",
    });
  });

  test("the overview shows where the money is, the month as a result, what needs the owner, and the latest movements", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/books");

    await expect(page.getByRole("heading", { name: "Books" })).toBeVisible();
    const where = page.getByRole("list", { name: "Cash & bank position" });
    await expect(where.getByText("−₹1,200.00")).toBeVisible();
    await expect(
      where.getByText("More has gone out than was put in"),
    ).toBeVisible();
    await expect(where.getByText("₹4,500.00")).toBeVisible();
    await expect(where.getByText("Cash with collection staff")).toBeVisible();
    await expect(where.getByText("₹1,900.00")).toBeVisible();

    const month = page.getByRole("region", { name: "This month" });
    await expect(month.getByText("Net loss")).toBeVisible();
    await expect(month.getByText("−₹2,785.00")).toBeVisible();
    await expect(month.getByText("₹10,000.00")).toBeVisible();

    const attention = page.getByRole("region", {
      name: "Pending actions",
    });
    await expect(
      attention.getByText("1 field expense is pending approval"),
    ).toBeVisible();
    await expect(
      attention.getByText("Cash-in-hand is negative", { exact: false }),
    ).toBeVisible();

    await expect(
      page.getByRole("list", { name: "Quick actions" }).getByRole("link"),
    ).toHaveCount(3);
    await expect(
      page
        .getByRole("list", { name: "Day book" })
        .getByText("Rent: September rent"),
    ).toBeVisible();
  });

  test("an Admin records an office expense paid from the bank", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    const sent = await capture(page, "**/api/expenses**", {
      ...rent,
      id: "exp-new",
      amount: "500.00",
      note: "Broadband",
      paidFrom: "BANK",
      from: { bankAccountId: "bank-sbi", name: "SBI Mylapore" },
    });
    await page.goto("/books/expenses");

    await expect(
      page.getByText("September rent").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Ravi's cash").filter({ visible: true }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Record expense" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record expense" });
    const what = dialog.getByRole("radiogroup", { name: "Expense head" });
    // A retired category is not offered for a new expense.
    await expect(what.getByRole("radio", { name: "Courier" })).toHaveCount(0);
    await what.getByRole("radio", { name: "Rent" }).click();
    await expect(what.getByRole("radio", { name: "Rent" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await dialog.getByLabel("Amount (₹)").fill("500");
    await dialog
      .getByRole("radiogroup", { name: "Paid from" })
      .getByRole("radio", { name: /A bank/ })
      .click();
    await dialog.getByLabel("Bank", { exact: true }).selectOption("bank-sbi");
    // The balance before and after, as it is typed.
    await expect(
      dialog.getByText("SBI Mylapore ₹4,500.00 → ₹4,000.00 after this"),
    ).toBeVisible();
    await dialog.getByLabel("Narration").fill("Broadband");
    await dialog.getByRole("button", { name: "Record ₹500.00" }).click();
    await expect(dialog).toBeHidden();
    expect(sent.at(-1)).toEqual({
      categoryId: "cat-rent",
      amount: "500",
      note: "Broadband",
      paidFrom: "BANK",
      bankAccountId: "bank-sbi",
    });
  });

  test("an expense paid from a bank is refused without the bank", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    const sent = await capture(page, "**/api/expenses**", rent);
    await page.goto("/books/expenses");

    await page.getByRole("button", { name: "Record expense" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record expense" });
    await dialog
      .getByRole("radiogroup", { name: "Expense head" })
      .getByRole("radio", { name: "Rent" })
      .click();
    await dialog.getByLabel("Amount (₹)").fill("500");
    await dialog
      .getByRole("radiogroup", { name: "Paid from" })
      .getByRole("radio", { name: /A bank/ })
      .click();
    await dialog.getByLabel("Narration").fill("Broadband");
    await dialog.getByRole("button", { name: "Record ₹500.00" }).click();
    await expect(dialog.getByText("Bank is required.")).toBeVisible();
    expect(sent).toEqual([]);
  });

  test("an Admin moves office cash into the bank, and is not offered a drawing", async ({
    page,
  }) => {
    test.skip(BOOKS_SIMPLE, HIDDEN);
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    const sent = await capture(page, "**/api/bank-transfers**", deposit);
    await page.goto("/books/money");

    const transfers = page.getByRole("list", { name: "Contra" });
    await expect(transfers.getByText("Cash-in-hand")).toBeVisible();
    await expect(transfers.getByText("SBI Mylapore")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record drawing" }),
    ).toHaveCount(0);
    await expect(page.getByText("Owner only")).toBeVisible();

    await page
      .getByRole("button", { name: "Contra entry", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Contra entry" });
    await dialog.getByLabel("Amount (₹)").fill("5000");
    // Each side shows its balance now and after.
    await expect(
      dialog.getByText("after ₹9,500.00", { exact: false }),
    ).toBeVisible();
    await dialog.getByLabel("Narration").fill("Deposit");
    await dialog.getByRole("button", { name: "Post contra ₹5,000.00" }).click();
    await expect(dialog).toBeHidden();
    expect(sent.at(-1)).toEqual({
      toBankAccountId: "bank-sbi",
      amount: "5000",
      note: "Deposit",
    });
  });

  test("the Super Admin records a drawing from office cash", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    const sent = await capture(page, "**/api/drawings**", {
      ...deposit,
      id: "mv-2",
      amount: "1000.00",
      note: "For home",
      to: null,
    });
    await page.goto("/books/money");

    await page.getByRole("button", { name: "Record drawing" }).click();
    const dialog = page.getByRole("dialog", { name: "Owner took money" });
    await dialog.getByLabel("Amount (₹)").fill("1000");
    await dialog.getByLabel("Note").fill("For home");
    await dialog.getByRole("button", { name: "Record drawing" }).click();
    await expect(dialog).toBeHidden();
    expect(sent.at(-1)).toEqual({ amount: "1000", note: "For home" });
  });

  test("a Senior is refused the books and has no Books link", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers);
    await page.goto("/books");

    await expect(
      page.getByText("The books are for Super Admins and Admins."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Books" })).toHaveCount(0);
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`all three pages fit a ${name}`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "SUPER_ADMIN", answers);
      await page.setViewportSize(viewport);
      for (const [path, text] of [
        ["/books", BOOKS_SIMPLE ? "Latest entries" : "SBI Mylapore"],
        ["/books/expenses", "September rent"],
        [
          "/books/money",
          BOOKS_SIMPLE ? "Owner took money" : "Deposit of Monday's collections",
        ],
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

test.describe("field expenses on the console (ADR-0018)", () => {
  const waiting = { ...petrol, canDecide: true };
  const fieldAnswers: ApiAnswers = {
    ...answers,
    "/api/expenses": paged([waiting], { approvedTotal: "0.00" }),
    "/api/cash": { json: { items: [], officeReceivers: [], recent: [] } },
    "/api/handovers": { json: { data: [] } },
  };

  test("a Senior approves a Junior's petrol from the Cash page", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", fieldAnswers);
    const sent: unknown[] = [];
    await page.route("**/api/expenses/*/decision", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        json: { ...waiting, status: "APPROVED", canDecide: false },
      });
    });
    await page.goto("/cash");

    const list = page.getByRole("list", {
      name: "Field expenses pending approval",
    });
    await expect(list.getByText("Ravi · Fuel & travel")).toBeVisible();
    await list.getByRole("button", { name: "Approve" }).click();
    await expect(
      page.getByText("₹50.00 fuel & travel approved").first(),
    ).toBeVisible();
    expect(sent).toEqual([{ decision: "APPROVED" }]);
    // The fake Senior is on no line today, so has no round to spend for.
    await expect(
      page.getByRole("button", { name: "Record field expense" }),
    ).toHaveCount(0);
  });

  test("rejecting asks why before anything is sent", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", fieldAnswers);
    const sent: unknown[] = [];
    await page.route("**/api/expenses/*/decision", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        json: { ...waiting, status: "REJECTED", canDecide: false },
      });
    });
    await page.goto("/cash");

    await page
      .getByRole("list", { name: "Field expenses pending approval" })
      .getByRole("button", { name: "Reject" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Reject ₹50.00 · Fuel & travel",
    });
    await dialog.getByRole("button", { name: "Reject expense" }).click();
    await expect(dialog.getByText("Reason is required.")).toBeVisible();
    expect(sent).toEqual([]);

    await dialog.getByLabel("Reason").fill("Petrol is paid weekly");
    await dialog.getByRole("button", { name: "Reject expense" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { decision: "REJECTED", note: "Petrol is paid weekly" },
    ]);
  });

  test("an Admin decides from the expenses list; one they may not decide shows who will", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", {
      ...fieldAnswers,
      "/api/expenses": paged([waiting, { ...petrol, id: "exp-own" }], {
        approvedTotal: "0.00",
      }),
    });
    await page.goto("/books/expenses");
    // In the waiting band and in its row of the list.
    await expect(
      page
        .getByRole("region", { name: "Pending approval" })
        .getByRole("button", { name: "Approve" }),
    ).toHaveCount(1);
    await expect(
      page
        .getByText("Waiting for someone else to approve")
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });
});
