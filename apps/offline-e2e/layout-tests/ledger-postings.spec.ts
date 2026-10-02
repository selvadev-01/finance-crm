import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * M09 "view transactions and entries" on `/reports/trial-balance/postings`, in
 * a real browser. **Writes nothing**: every answer is a fixture. The postings
 * themselves are proven in
 * `apps/api/test/ledger/ledger-transactions.service.spec.ts`; this proves the
 * screen.
 */

const COMPUTER = { width: 1280, height: 900 };
const PATH = "/reports/trial-balance/postings?from=2026-09-01&to=2026-09-23";

const entry = (
  accountType: string,
  direction: "DEBIT" | "CREDIT",
  amount: string,
  extra: Record<string, unknown> = {},
) => ({
  accountType,
  ownerName: null,
  referenceName: null,
  accountLoanId: null,
  accountCode: null,
  direction,
  amount,
  ...extra,
});

const disbursement = {
  id: "txn-1",
  transactionType: "DISBURSEMENT",
  businessDate: "2026-09-20",
  eventAt: "2026-09-20T05:00:00.000Z",
  description: "Disbursement ACC-2026-00412",
  sourceTable: "account_loan",
  sourceId: "acc-412",
  createdByName: "Lakshmi K",
  entries: [
    entry("LOAN_RECEIVABLE", "DEBIT", "2000.00", {
      accountLoanId: "acc-412",
      accountCode: "ACC-2026-00412",
    }),
    entry("CASH_AT_OFFICE", "CREDIT", "1700.00"),
    entry("UNEARNED_PROFIT", "CREDIT", "300.00"),
  ],
  amount: "2000.00",
};

const collection = {
  ...disbursement,
  id: "txn-2",
  transactionType: "COLLECTION",
  businessDate: "2026-09-22",
  description: "Collection ACC-2026-00412",
  sourceTable: "collection",
  sourceId: "col-9",
  createdByName: "Selvi M",
  entries: [
    entry("CASH_IN_HAND", "DEBIT", "100.00", { ownerName: "Selvi M" }),
    entry("UNEARNED_PROFIT", "DEBIT", "15.00"),
    entry("LOAN_RECEIVABLE", "CREDIT", "100.00", {
      accountLoanId: "acc-412",
      accountCode: "ACC-2026-00412",
    }),
    entry("EARNED_PROFIT", "CREDIT", "15.00"),
  ],
  amount: "115.00",
};

const page_ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

const answers = (data: unknown[] = [collection, disbursement]): ApiAnswers => ({
  "/api/ledger/transactions": page_(data),
});

const shown = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("ledger postings (M09)", () => {
  test("lists each posting with the accounts it debited and credited", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);

    await expect(
      page.getByRole("heading", { name: "Ledger postings" }),
    ).toBeVisible();
    const postings = page.getByRole("list", { name: "Postings" });
    await expect(postings.getByRole("listitem")).toHaveCount(2);

    const first = postings.getByRole("listitem").first();
    await expect(first.getByText("Collection", { exact: true })).toBeVisible();
    await expect(first.getByText("Cash in hand · Selvi M")).toBeVisible();
    await expect(
      first.getByText("Loan receivable · ACC-2026-00412"),
    ).toBeVisible();
    await expect(first.getByText("₹115.00")).toBeVisible();
    // The description links to the collection that caused it.
    await expect(
      first.getByRole("link", { name: "Collection ACC-2026-00412" }),
    ).toHaveAttribute("href", "/collections/col-9");
  });

  test("asks for the chosen range and kind", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers());
    const asked: URL[] = [];
    await page.route("**/api/ledger/transactions**", async (route) => {
      asked.push(new URL(route.request().url()));
      await route.fallback();
    });
    await page.goto(PATH);
    await expect(shown(page, "Disbursement ACC-2026-00412")).toBeVisible();
    expect(asked.at(-1)?.searchParams.get("from")).toBe("2026-09-01");
    expect(asked.at(-1)?.searchParams.get("to")).toBe("2026-09-23");

    await page.getByLabel("Kind").selectOption("CAPITAL");
    await expect
      .poll(() => asked.at(-1)?.searchParams.get("type"))
      .toBe("CAPITAL");
  });

  test("a kind with nothing in range offers every kind back", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers([]));
    await page.goto(`${PATH}&type=CAPITAL`);

    await expect(
      page.getByText("No capital postings in this range"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Every kind" }),
    ).toBeVisible();
  });

  test("a range with nothing posted says so", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers([]));
    await page.goto(PATH);

    await expect(page.getByText("Nothing posted in this range")).toBeVisible();
  });

  test("a Senior is not shown the ledger", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers());
    await page.goto(PATH);

    await expect(
      page.getByText("The ledger is for Super Admins and Admins."),
    ).toBeVisible();
  });

  test("the trial balance links here for its own date's month", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", {
      ...answers(),
      "/api/ledger/trial-balance": {
        json: {
          asOf: "2026-08-14",
          generatedAt: "2026-08-14T10:00:00.000Z",
          rows: [],
          totals: { debitBalance: "0.00", creditBalance: "0.00" },
          balanced: true,
        },
      },
    });
    await page.goto("/reports/trial-balance?date=2026-08-14");

    await expect(
      page.getByRole("link", { name: "View postings" }),
    ).toHaveAttribute(
      "href",
      "/reports/trial-balance/postings?from=2026-08-01&to=2026-08-14",
    );
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto(PATH);

      await expect(shown(page, "Disbursement ACC-2026-00412")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
    });
  }
});
