import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-22, the line-wise report (US-084, PDF §14), at the three widths.
 * **Writes nothing**: no sign-in, and every figure is a fixture shaped by
 * `reportContract.getLineWise`. That the figures are right is proven at the
 * API (`apps/api/test/reports/`); what is proven here is that the screen
 * draws them, says when a line is short, and fits a phone.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const mylapore = {
  lineId: "line-1",
  code: "LIN-00001",
  name: "Mylapore East",
  isActive: true,
  sectorId: "sec-1",
  sectorCode: "SEC-00001",
  sectorName: "Mylapore",
  staff: { seniorName: "Karthik R", juniorNames: ["Selvi M", "Meena R"] },
  book: {
    customers: 84,
    accounts: 97,
    activeAccounts: 81,
    completedAccounts: 16,
  },
  amounts: {
    accountAmount: "1940000.00",
    invested: "1649000.00",
    profit: "291000.00",
  },
  collections: {
    expected: "112350.00",
    collected: "108420.00",
    pending: "4320.00",
    extra: "390.00",
  },
};

/** No Senior assigned and nothing short: the screen says "None", not blank. */
const triplicane = {
  ...mylapore,
  lineId: "line-2",
  code: "LIN-00002",
  name: "Triplicane High Road",
  sectorId: "sec-2",
  sectorCode: "SEC-00002",
  sectorName: "Triplicane",
  staff: { seniorName: null, juniorNames: ["Suresh P"] },
  book: {
    customers: 61,
    accounts: 64,
    activeAccounts: 60,
    completedAccounts: 4,
  },
  amounts: {
    accountAmount: "1280000.00",
    invested: "1088000.00",
    profit: "192000.00",
  },
  collections: {
    expected: "76800.00",
    collected: "76800.00",
    pending: "0.00",
    extra: "0.00",
  },
};

const report = {
  from: "2026-09-01",
  to: "2026-09-23",
  generatedAt: "2026-09-23T10:00:00.000Z",
  lines: [mylapore, triplicane],
  totals: {
    lines: 2,
    book: {
      customers: 145,
      accounts: 161,
      activeAccounts: 141,
      completedAccounts: 20,
    },
    amounts: {
      accountAmount: "3220000.00",
      invested: "2737000.00",
      profit: "483000.00",
    },
    collections: {
      expected: "189150.00",
      collected: "185220.00",
      pending: "4320.00",
      extra: "390.00",
    },
  },
};

const answers = (body: unknown = report): ApiAnswers => ({
  "/api/reports/line-wise": { json: body },
  "/api/sectors": {
    json: {
      data: [
        { id: "sec-1", code: "SEC-00001", name: "Mylapore", isActive: true },
        { id: "sec-2", code: "SEC-00002", name: "Triplicane", isActive: true },
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
});

/** An explicit range, so the screen never depends on today's date. */
const PATH = "/reports/line-wise?from=2026-09-01&to=2026-09-23";

test.describe("the line-wise report (S-22, US-084)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    test(`${role} sees every line with its people, book and collections`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role, answers());
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Line-wise report" }),
      ).toBeVisible();
      await expect(shown(page, "Mylapore East")).toBeVisible();
      await expect(shown(page, "Triplicane High Road")).toBeVisible();
      await expect(shown(page, "Selvi M, Meena R")).toBeVisible();
      // The period's money, all lines together.
      const totals = page.locator('dl[aria-label="Collections in the range"]');
      await expect(totals.getByText("₹1,89,150.00")).toBeVisible();
      await expect(totals.getByText("₹4,320.00")).toBeVisible();
      // An Admin narrows by sector; the filter is there.
      await expect(page.getByLabel("Sector")).toBeVisible();
    });
  }

  test("a line with pending money shows it as a shortfall, a line without shows zero plainly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    const table = page.getByRole("table");
    const short = table.getByRole("row", { name: /Mylapore East/ });
    const pending = short.locator(".text-critical", { hasText: "₹4,320.00" });
    await expect(pending).toBeVisible();

    const even = table.getByRole("row", { name: /Triplicane High Road/ });
    await expect(even.locator(".text-critical")).toHaveCount(0);
    // No Senior is "None", never an empty cell.
    await expect(even.getByText("None")).toBeVisible();
  });

  test("a Senior sees their own line, with no sector or line filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(
      page,
      "SENIOR",
      answers({ ...report, lines: [mylapore], totals: report.totals }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, "Your line’s people, book and collections."),
    ).toBeVisible();
    await expect(shown(page, "Mylapore East")).toBeVisible();
    await expect(page.getByLabel("Sector")).toHaveCount(0);
  });

  test("with no lines yet it says so instead of an empty table", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({ ...report, lines: [], totals: null }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "No lines yet")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a range the API would refuse asks for another instead of reading", async ({
    page,
  }) => {
    let asked = 0;
    await signedInAs(page, "ADMIN", {
      ...answers(),
      "/api/reports/line-wise": () => {
        asked += 1;
        return { json: report };
      },
    });
    await page.goto("/reports/line-wise?from=2026-09-20&to=2026-09-10");
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "Choose a date range")).toBeVisible();
    expect(asked).toBe(0);
  });
});

test.describe("the line-wise report at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(shown(page, "Mylapore East")).toBeVisible();
      expect(
        await overflows(page),
        `the report scrolls sideways at ${name}`,
      ).toBe(false);
    });
  }
});
