import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs } from "./fake-api";

/**
 * A mid-term account is paid out of cash-in-hand too (decided 2026-10-03): it
 * takes the amount given less what was collected before, so the form shows
 * cash-in-hand now and after, and says when it is not enough. **Writes
 * nothing**: every answer is a fixture and the account is never saved. The
 * refusal itself (`INSUFFICIENT_CASH_IN_HAND`) is proven in Tier 1; this
 * proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };

const customer = {
  id: "cus-krishna",
  customerCode: "CUS-00612",
  name: "Krishna",
  mobile: "+919842155020",
  status: "ACTIVE",
  lineId: "line-7",
  lineName: "Market Road",
  sectorId: "sec-1",
  sectorName: "Chennai",
  alternateMobile: null,
  address: "8 Temple Street",
  notes: null,
  references: [],
};

/** ₹10,000 at ₹100 a day, ₹300 of it paid before Rasi. */
const midTermPreview = {
  kind: "MID_TERM",
  profitAmount: "1500.00",
  collectedAmount: "300.00",
  outstandingAmount: "9700.00",
  amountBehind: "0.00",
  firstCollectionDate: "2026-01-06",
  targetCompletionDate: "2026-05-01",
  slotCount: 3,
  slots: [1, 2, 3].map((sequence) => ({
    sequence,
    dueDate: `2026-01-0${5 + sequence}`,
    expectedAmount: "100.00",
    status: "COLLECTED",
  })),
  holidaysSkipped: [],
};

const answers = (officeCash: string): ApiAnswers => ({
  "/api/customers/cus-krishna": { json: customer },
  "/api/accounts": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/accounts/preview": { json: midTermPreview },
  "/api/books/overview": {
    json: {
      asOf: "2026-10-03",
      officeCash,
      banks: [],
      month: {
        from: "2026-10-01",
        expenses: "0.00",
        otherIncome: "0.00",
        drawings: "0.00",
        capital: "0.00",
        pendingFieldExpenses: 0,
      },
    },
  },
});

/** ₹8,500 given on a past date, ₹300 back: it takes ₹8,200. */
async function enterMidTerm(page: Page) {
  await page.goto("/accounts/new?customerId=cus-krishna");
  await page.getByLabel("Account amount (₹)").fill("10000");
  await page.getByLabel("Invested amount (₹)").fill("8500");
  await page.getByLabel("Daily amount (₹)").fill("100");
  await page.getByLabel("Disbursement date").fill("2026-01-05");
  await page.getByLabel("Collected to date (₹)").fill("300");
}

test.describe("a mid-term account is paid out of cash-in-hand", () => {
  test("shows cash-in-hand now and after the account, net of what came back", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers("20000.00"));
    await enterMidTerm(page);

    const cash = page.getByRole("definition");
    await expect(cash.getByText("₹20,000.00")).toBeVisible();
    // 20,000 less 8,500 given plus 300 back.
    await expect(cash.getByText("₹11,800.00")).toBeVisible();
    await expect(
      page.getByText(
        "Takes ₹8,200.00: the amount given, less what was collected before.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Not enough cash in hand", { exact: false }),
    ).toHaveCount(0);
  });

  test("short, the Super Admin is offered to add money", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("5000.00"));
    await enterMidTerm(page);

    await expect(page.getByText("−₹3,200.00")).toBeVisible();
    await expect(
      page.getByText(
        "Not enough cash in hand for this account. Add money first.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add money" })).toHaveAttribute(
      "href",
      "/books/money?action=capital",
    );
  });

  test("short, an Admin is sent to the owner, who alone adds money", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers("5000.00"));
    await enterMidTerm(page);

    await expect(
      page.getByText(
        "Not enough cash in hand for this account. Ask the owner to add money first.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add money" })).toHaveCount(0);
  });
});
