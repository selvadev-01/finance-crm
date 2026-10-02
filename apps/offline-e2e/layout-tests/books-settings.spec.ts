import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * Books slice 1 (ADR-0018): the expense categories and bank accounts settings
 * tabs, in a real browser. **Writes nothing**: every answer is a fixture and
 * every write is captured and answered here. Who may change them is proven in
 * the RBAC harness; the rules (unique names, no retiring a bank holding
 * money) in `apps/api/test/books/`.
 */

const COMPUTER = { width: 1280, height: 900 };

const categories = [
  { id: "cat-rent", name: "Rent", isActive: true },
  { id: "cat-fuel", name: "Fuel & travel", isActive: true },
];

const banks = [
  {
    id: "bank-sbi",
    name: "SBI Mylapore",
    last4: "4321",
    isActive: true,
    balance: "25000.00",
  },
  {
    id: "bank-iob",
    name: "IOB Triplicane",
    last4: null,
    isActive: true,
    balance: "0.00",
  },
];

const answers: ApiAnswers = {
  "/api/expense-categories": { json: { data: categories } },
  "/api/bank-accounts": { json: { data: banks } },
};

/** Captures the writes to a path, answering each with `reply`. */
async function capture(page: Page, pattern: string, reply: unknown) {
  const sent: { method: string; body: unknown }[] = [];
  await page.route(pattern, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    sent.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    // A create answers 201, as the contract says; anything else is a failure.
    const status = route.request().method() === "POST" ? 201 : 200;
    await route.fulfill({ status, json: reply });
  });
  return sent;
}

test.describe("expense categories (ADR-0018)", () => {
  test("the Super Admin adds a category, and retires one after being told what that means", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    const sent = await capture(page, "**/api/expense-categories**", {
      id: "cat-new",
      name: "Electricity",
      isActive: true,
    });
    await page.goto("/settings/expense-categories");

    const list = page.getByRole("list", { name: "Expense heads" });
    await expect(list.getByText("Fuel & travel")).toBeVisible();

    await page.getByRole("button", { name: "Add expense head" }).click();
    const add = page.getByRole("dialog", { name: "Add an expense head" });
    await add.getByLabel("Name").fill("Electricity");
    await add.getByRole("button", { name: "Add expense head" }).click();
    await expect(add).toBeHidden();
    expect(sent.at(-1)).toEqual({
      method: "POST",
      body: { name: "Electricity" },
    });

    await list
      .getByRole("listitem")
      .filter({ hasText: "Rent" })
      .getByRole("button", { name: "Retire" })
      .click();
    const retire = page.getByRole("dialog", { name: "Retire Rent" });
    await expect(
      retire.getByText("What was already spent stays in the books", {
        exact: false,
      }),
    ).toBeVisible();
    await retire.getByRole("button", { name: "Retire" }).click();
    await expect(retire).toBeHidden();
    expect(sent.at(-1)).toEqual({
      method: "PATCH",
      body: { name: "Rent", isActive: false },
    });
  });

  test("an Admin reads the categories but is not offered to change them", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/settings/expense-categories");

    await expect(page.getByText("Fuel & travel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add expense head" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retire" })).toHaveCount(0);
  });
});

test.describe("bank accounts (ADR-0018)", () => {
  test("shows each bank's balance, and will not retire one that holds money", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    await page.goto("/settings/bank-accounts");

    const list = page.getByRole("list", { name: "Bank accounts" });
    const sbi = list.getByRole("listitem").filter({ hasText: "SBI Mylapore" });
    await expect(sbi.getByText("₹25,000.00")).toBeVisible();
    await expect(sbi.getByText("A/c no. ending 4321")).toBeVisible();

    await sbi.getByRole("button", { name: "Retire" }).click();
    const retire = page.getByRole("dialog", { name: "Retire SBI Mylapore" });
    await expect(
      retire.getByText("It still holds money", { exact: false }),
    ).toBeVisible();
    await expect(retire.getByRole("button", { name: "Retire" })).toBeDisabled();
  });

  test("the Super Admin adds a bank with only its last four digits", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    const sent = await capture(page, "**/api/bank-accounts**", {
      id: "bank-new",
      name: "HDFC Adyar",
      last4: "9876",
      isActive: true,
      balance: "0.00",
    });
    await page.goto("/settings/bank-accounts");

    await page.getByRole("button", { name: "Add bank account" }).click();
    const add = page.getByRole("dialog", { name: "Add a bank account" });
    await add.getByLabel("Name").fill("HDFC Adyar");
    await add.getByLabel("Last four digits (optional)").fill("9876");
    await add.getByRole("button", { name: "Add bank account" }).click();
    await expect(add).toBeHidden();
    expect(sent.at(-1)).toEqual({
      method: "POST",
      body: { name: "HDFC Adyar", last4: "9876" },
    });
  });

  test("a Senior has neither tab", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers);
    await page.goto("/settings/holidays");

    await expect(page.getByRole("link", { name: "Expense heads" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Bank accounts" })).toHaveCount(
      0,
    );
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`both pages fit a ${name}`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "SUPER_ADMIN", answers);
      await page.setViewportSize(viewport);
      for (const [path, text] of [
        ["/settings/expense-categories", "Fuel & travel"],
        ["/settings/bank-accounts", "SBI Mylapore"],
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
