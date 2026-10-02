import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * M09's trial balance on `/reports/trial-balance`, in a real browser.
 * **Writes nothing**: every answer is a fixture. The figures — read from the
 * entries, to the paisa — are proven in
 * `apps/api/test/ledger/trial-balance.service.spec.ts`; who may read it, in
 * the RBAC harness. This proves the screen.
 */

const COMPUTER = { width: 1280, height: 900 };
const DATE = "2026-09-23";
const PATH = `/reports/trial-balance?date=${DATE}`;

const row = (
  accountType: string,
  debitBalance: string,
  creditBalance: string,
  extra: Record<string, unknown> = {},
) => ({
  accountType,
  ownerUserId: null,
  ownerName: null,
  referenceId: null,
  referenceName: null,
  accounts: 1,
  ledgerAccountId: null,
  debits: debitBalance === "0.00" ? "0.00" : debitBalance,
  credits: creditBalance === "0.00" ? "0.00" : creditBalance,
  debitBalance,
  creditBalance,
  ...extra,
});

/** The worked example of the Tier 1 spec, as the API returns it. */
const balanced = {
  asOf: DATE,
  generatedAt: "2026-09-23T10:00:00.000Z",
  rows: [
    row("CASH_AT_OFFICE", "3300.00", "0.00"),
    row("CASH_IN_HAND", "100.00", "0.00", {
      ownerUserId: "user-junior",
      ownerName: "Selvi M",
    }),
    row("LOAN_RECEIVABLE", "1900.00", "0.00", { accounts: 12 }),
    row("CAPITAL", "0.00", "5000.00", { ledgerAccountId: "la-capital" }),
    row("UNEARNED_PROFIT", "0.00", "285.00"),
    row("EARNED_PROFIT", "0.00", "15.00"),
  ],
  totals: { debitBalance: "5300.00", creditBalance: "5300.00" },
  balanced: true,
};

const answers = (json: unknown): ApiAnswers => ({
  "/api/ledger/trial-balance": { json },
});

const shown = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("the trial balance (M09)", () => {
  test("states each account on its side, with equal totals, for an Admin", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers(balanced));
    await page.goto(PATH);

    await expect(
      page.getByRole("heading", { name: "Trial balance" }),
    ).toBeVisible();
    await expect(shown(page, "Cash in hand · Selvi M")).toBeVisible();
    await expect(shown(page, "Loan receivables · 12 accounts")).toBeVisible();
    await expect(shown(page, "₹3,300.00")).toBeVisible();
    await expect(shown(page, "₹5,000.00")).toBeVisible();
    await expect(shown(page, "Total debit")).toBeVisible();
    await expect(page.getByText("₹5,300.00").first()).toBeVisible();
    await expect(
      page
        .getByText("Balanced", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByText("The two sides do not agree")).toHaveCount(0);
  });

  test("asks for the chosen date", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers(balanced));
    const asked: string[] = [];
    await page.route("**/api/ledger/trial-balance**", async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("date") ?? "");
      await route.fallback();
    });
    await page.goto(PATH);
    await expect(shown(page, "Cash at office")).toBeVisible();

    await page.getByLabel("As of").fill("2026-09-01");
    await expect.poll(() => asked.at(-1)).toBe("2026-09-01");
  });

  test("an out-of-balance ledger is reported as a fault", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...balanced,
        totals: { debitBalance: "5300.00", creditBalance: "5299.00" },
        balanced: false,
      }),
    );
    await page.goto(PATH);

    await expect(
      page.getByText("The two sides do not agree", { exact: false }),
    ).toBeVisible();
    await expect(shown(page, "Out of balance")).toBeVisible();
  });

  test("an empty ledger says nothing is posted yet", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...balanced,
        rows: [],
        totals: { debitBalance: "0.00", creditBalance: "0.00" },
      }),
    );
    await page.goto(PATH);

    await expect(page.getByText("Nothing posted yet")).toBeVisible();
  });

  test("a Senior is not shown the ledger, and asks the API nothing", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SENIOR", answers(balanced));
    let asked = 0;
    await page.route("**/api/ledger/trial-balance**", async (route) => {
      asked += 1;
      await route.fallback();
    });
    await page.goto(PATH);

    await expect(
      page.getByText("The ledger is for Super Admins and Admins."),
    ).toBeVisible();
    expect(asked).toBe(0);
  });

  test("the reports index lists it for an Admin, never for a Senior", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN");
    await page.goto("/reports");
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Trial balance/ }),
    ).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await signedInAs(page, "SENIOR");
    await page.goto("/reports");
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Line-wise/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: /^Trial balance/ }),
    ).toHaveCount(0);
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", COMPUTER],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers(balanced));
      await page.setViewportSize(viewport);
      await page.goto(PATH);

      await expect(shown(page, "Cash at office")).toBeVisible();
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
