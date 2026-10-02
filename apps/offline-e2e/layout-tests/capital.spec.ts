import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-032 capital on `/books/money` (moved from `/cash` 2026-10-02), in a real browser. **It writes nothing**: no
 * sign-in, and every `/api/…` answer is a fixture — the POST is captured and
 * answered here, never sent. Recording capital is proven in Tier 1
 * (`apps/api/test/cash/capital.service.spec.ts`) and who may do it in the
 * RBAC harness; this proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };

const entry = {
  id: "cap-1",
  amount: "20000.00",
  businessDate: "2026-09-01",
  note: "Opening capital from the owner’s savings",
  addedBy: { userId: "user-owner", name: "Sri Murugan" },
  createdAt: "2026-09-01T05:00:00.000Z",
};

const answers = (officeCash: string): ApiAnswers => ({
  "/api/handovers": { json: { data: [] } },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
  // The rest of the money page, quiet.
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
        capital: "20000.00",
        pendingFieldExpenses: 0,
      },
    },
  },
  "/api/bank-accounts": { json: { data: [] } },
  "/api/bank-transfers": {
    json: { data: [], nextCursor: null, hasMore: false, amountTotal: "0.00" },
  },
  "/api/capital": {
    json: {
      data: [entry],
      nextCursor: null,
      hasMore: false,
      totalCapital: "20000.00",
      officeCash,
    },
  },
});

const section = (page: Page) =>
  page.getByRole("region", { name: "Capital A/c" });

test.describe("capital on Books (US-032)", () => {
  test("the Super Admin sees office cash, what was put in, and may add capital", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("18300.00"));
    await page.goto("/books/money");

    const capital = section(page);
    await expect(
      capital.getByText("Cash-in-hand", { exact: true }),
    ).toBeVisible();
    await expect(capital.getByText("₹18,300.00")).toBeVisible();
    await expect(capital.getByText("₹20,000.00").first()).toBeVisible();
    await expect(
      capital.getByText("Opening capital from the owner’s savings"),
    ).toBeVisible();
    await expect(capital.getByText("by Sri Murugan")).toBeVisible();
    await expect(
      capital.getByRole("button", { name: "Add capital" }),
    ).toBeVisible();
  });

  test("cash-in-hand below zero is flagged as more paid out than put in", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("-1700.00"));
    await page.goto("/books/money");

    await expect(
      section(page).getByText("More has been paid out than put in."),
    ).toBeVisible();
    // A true minus (U+2212), as every signed figure in the console.
    await expect(section(page).getByText("−₹1,700.00")).toBeVisible();
  });

  test("with nothing recorded, the Super Admin is offered to add the first entry and an Admin is not", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    const none = {
      ...answers("-1700.00"),
      "/api/capital": {
        json: {
          data: [],
          nextCursor: null,
          hasMore: false,
          totalCapital: "0.00",
          officeCash: "-1700.00",
        },
      },
    };
    await signedInAs(page, "SUPER_ADMIN", none);
    await page.goto("/books/money");
    await expect(
      section(page).getByText("No capital recorded yet"),
    ).toBeVisible();
    // The header's button and the empty state's.
    await expect(
      section(page).getByRole("button", { name: "Add capital" }),
    ).toHaveCount(2);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await signedInAs(page, "ADMIN", none);
    await page.goto("/books/money");
    await expect(
      section(page).getByText("No capital recorded yet"),
    ).toBeVisible();
    await expect(
      section(page).getByRole("button", { name: "Add capital" }),
    ).toHaveCount(0);
  });

  test("an Admin reads capital but is not offered to add it, as the API would refuse", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers("18300.00"));
    await page.goto("/books/money");

    await expect(
      section(page).getByText("Cash-in-hand", { exact: true }),
    ).toBeVisible();
    await expect(
      section(page).getByRole("button", { name: "Add capital" }),
    ).toHaveCount(0);
  });

  test("the cash page has no capital any more — it lives on Books", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", {
      ...answers("18300.00"),
      "/api/cash": { json: { items: [], officeReceivers: [] } },
    });
    await page.goto("/cash");

    await expect(page.getByRole("heading", { name: "Cash" })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test("adding capital with the date left blank sends no date, for the API to make today", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("18300.00"));
    let sent: Record<string, unknown> | undefined;
    // Registered after `signedInAs`, so it answers the POST first; the GET
    // falls through to the fixture.
    await page.route("**/api/capital", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        json: {
          ...entry,
          id: "cap-2",
          amount: "5000.00",
          businessDate: "2026-09-24",
          note: "Gold loan",
        },
      });
    });

    await page.goto("/books/money");
    await section(page).getByRole("button", { name: "Add capital" }).click();
    const dialog = page.getByRole("dialog", { name: "Add capital" });
    await expect(
      dialog.getByText("An entry cannot be changed afterwards"),
    ).toBeVisible();
    await dialog.getByLabel("Amount (₹)").fill("5,000");
    await dialog.getByLabel("Narration").fill("  Gold loan  ");
    await dialog.getByRole("button", { name: "Add capital" }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual({ amount: "5000", note: "Gold loan" });
  });

  test("a blank amount and note are refused on the form, and nothing is sent", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("18300.00"));
    let posts = 0;
    await page.route("**/api/capital", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts += 1;
      await route.fulfill({ status: 500, json: {} });
    });

    await page.goto("/books/money");
    await section(page).getByRole("button", { name: "Add capital" }).click();
    const dialog = page.getByRole("dialog", { name: "Add capital" });
    await dialog.getByRole("button", { name: "Add capital" }).click();

    await expect(dialog.getByText("Amount (₹) is required.")).toBeVisible();
    await expect(dialog.getByText("Narration is required.")).toBeVisible();
    expect(posts).toBe(0);
  });

  test("the disburse dialog's Add capital link opens the form straight away", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers("-1700.00"));
    await page.goto("/books/money?action=capital");
    await expect(
      page.getByRole("dialog", { name: "Add capital" }),
    ).toBeVisible();
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
  ] as const) {
    test(`the capital section fits a ${name}`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "SUPER_ADMIN", answers("-1700.00"));
      await page.setViewportSize(viewport);
      await page.goto("/books/money");

      await expect(
        section(page).getByText("Cash-in-hand", { exact: true }),
      ).toBeVisible();
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows, `/books/money scrolls sideways at ${name}`).toBe(false);
    });
  }
});
