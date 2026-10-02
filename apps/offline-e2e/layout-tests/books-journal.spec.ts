import { expect, test } from "@playwright/test";

import { BOOKS_SIMPLE } from "../../web/lib/books-mode";
import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/** Why a test of a screen hidden in simple Books skips (lib/books-mode.ts). */
const HIDDEN = "Hidden in simple Books; kept for when BOOKS_SIMPLE is off";

/**
 * Books slice 5 (ADR-0018): the manual journal on `/books/journal`, in a real
 * browser. **Writes nothing**: every answer is a fixture and the one write is
 * captured here. Balancing, the barred accounts and who may post are proven
 * in `apps/api/test/books/journal.service.spec.ts` and the RBAC harness.
 */

const COMPUTER = { width: 1280, height: 900 };

const entry = {
  id: "je-1",
  businessDate: "2026-01-05",
  note: "January rent was booked as miscellaneous",
  lines: [
    {
      accountType: "EXPENSE",
      name: "Rent",
      direction: "DEBIT",
      amount: "500.00",
    },
    {
      accountType: "EXPENSE",
      name: "Miscellaneous",
      direction: "CREDIT",
      amount: "500.00",
    },
  ],
  amount: "500.00",
  recordedBy: { userId: "user-owner", name: "Karthik" },
  createdAt: "2026-01-05T10:00:00.000Z",
};

const answers: ApiAnswers = {
  "/api/journal-entries": {
    json: { data: [entry], nextCursor: null, hasMore: false, total: 1 },
  },
  "/api/bank-accounts": {
    json: {
      data: [
        {
          id: "bank-sbi",
          name: "SBI Mylapore",
          last4: "4321",
          isActive: true,
          balance: "5000.00",
        },
      ],
    },
  },
  "/api/expense-categories": {
    json: {
      data: [
        { id: "cat-charges", name: "Bank charges", isActive: true },
        { id: "cat-old", name: "Courier", isActive: false },
      ],
    },
  },
};

test.describe("the manual journal (ADR-0018)", () => {
  test.skip(BOOKS_SIMPLE, HIDDEN);
  test("an Admin reads each entry's lines but is not offered to post one", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/books/journal");

    const list = page.getByRole("list", { name: "Journal vouchers" });
    await expect(
      list.getByText("January rent was booked as miscellaneous"),
    ).toBeVisible();
    await expect(
      list.getByText("Miscellaneous", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New journal voucher" }),
    ).toHaveCount(0);
  });

  test("the owner posts a balanced entry for bank charges", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    const sent: unknown[] = [];
    await page.route("**/api/journal-entries", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: {
          ...entry,
          id: "je-2",
          note: "Passbook charges",
          amount: "50.00",
        },
      });
    });
    await page.goto("/books/journal");

    // The shortcut starts the entry with both accounts already chosen.
    await page
      .getByRole("list", { name: "Templates" })
      .getByRole("button", { name: /Bank charges from the passbook/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "New journal voucher" });
    // A retired category is not offered.
    await expect(dialog.getByRole("option", { name: "Courier" })).toHaveCount(
      0,
    );
    await expect(dialog.getByLabel("Line 1 account")).toHaveValue(
      "EXPENSE:cat-charges",
    );
    await expect(dialog.getByLabel("Line 2 account")).toHaveValue(
      "BANK:bank-sbi",
    );
    await dialog.getByLabel("Line 1 debit").fill("50");
    await dialog.getByLabel("Line 2 credit").fill("50");
    await expect(dialog.getByText("Balanced")).toBeVisible();
    await dialog.getByLabel("Narration").fill("Passbook charges");
    await dialog.getByRole("button", { name: "Post entry" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        note: "Passbook charges",
        lines: [
          {
            accountType: "EXPENSE",
            categoryId: "cat-charges",
            direction: "DEBIT",
            amount: "50",
          },
          {
            accountType: "BANK",
            bankAccountId: "bank-sbi",
            direction: "CREDIT",
            amount: "50",
          },
        ],
      },
    ]);
  });

  test("an unbalanced entry shows how far out it is and sends nothing", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    let posts = 0;
    await page.route("**/api/journal-entries", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts += 1;
      await route.fulfill({ status: 201, json: entry });
    });
    await page.goto("/books/journal");

    await page.getByRole("button", { name: "New journal voucher" }).click();
    const dialog = page.getByRole("dialog", { name: "New journal voucher" });
    await dialog.getByLabel("Line 1 account").selectOption("CAPITAL");
    await dialog.getByLabel("Line 1 debit").fill("100");
    await dialog.getByLabel("Line 2 account").selectOption("CASH_AT_OFFICE");
    await dialog.getByLabel("Line 2 credit").fill("90");
    await expect(dialog.getByText("Out by ₹10.00")).toBeVisible();
    await dialog.getByLabel("Narration").fill("Opening");
    await dialog.getByRole("button", { name: "Post entry" }).click();
    await expect(
      dialog.getByText("must be equal", { exact: false }),
    ).toBeVisible();
    expect(posts).toBe(0);
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`the journal and its form fit a ${name}`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "SUPER_ADMIN", answers);
      await page.setViewportSize(viewport);
      await page.goto("/books/journal");
      await expect(
        page
          .getByText("January rent was booked as miscellaneous")
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "New journal voucher" }).click();
      await expect(page.getByLabel("Line 1 account")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
        `journal at ${name}`,
      ).toBe(false);
    });
  }
});
