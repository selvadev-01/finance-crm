import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * The sector comparison (US-081, PDF §18, §19), at the three widths.
 * **Writes nothing**: no sign-in, and every figure is a fixture shaped by
 * `dashboardContract.getSectors`. The date is in the URL so the screen never
 * depends on today. That the figures add up is proven at the API
 * (`apps/api/test/dashboards/`); what is proven here is that the screen draws
 * the sectors side by side, marks a low day as a shortfall, and is the
 * Admins' alone (`money.sectorTotals`).
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

const DATE = "2026-09-23";

const day = (
  expected: string,
  collected: string,
  shortfall: string,
  surplus: string,
  tally: "TALLIED" | "CLOSED" | "OPEN" | "NO_COLLECTIONS",
  linesToClose: number,
  linesTallied: number,
) => ({
  expected,
  collected,
  shortfall,
  surplus,
  lowCount: shortfall === "0.00" ? 0 : 6,
  extraCount: surplus === "0.00" ? 0 : 1,
  linesToClose,
  linesClosed: linesTallied,
  linesTallied,
  tally,
});

const mylapore = {
  sectorId: "sec-1",
  code: "SEC-00001",
  name: "Mylapore",
  isActive: true,
  structure: { lines: 5, customers: 412 },
  totals: {
    accountAmount: "8240000.00",
    invested: "7004000.00",
    profit: "1236000.00",
  },
  today: day("80250.00", "75930.00", "4320.00", "0.00", "OPEN", 5, 3),
};

const triplicane = {
  sectorId: "sec-2",
  code: "SEC-00002",
  name: "Triplicane",
  isActive: true,
  structure: { lines: 7, customers: 636 },
  totals: {
    accountAmount: "10210000.00",
    invested: "8678500.00",
    profit: "1531500.00",
  },
  today: day("104250.00", "104850.00", "0.00", "600.00", "TALLIED", 7, 7),
};

const comparison = {
  businessDate: DATE,
  day: { kind: "WORKING" },
  generatedAt: "2026-09-23T10:00:00.000Z",
  setupNeeded: false,
  sectors: [mylapore, triplicane],
  business: {
    structure: { sectors: 2, lines: 12, customers: 1048 },
    totals: {
      accountAmount: "18450000.00",
      invested: "15682500.00",
      profit: "2767500.00",
    },
    today: {
      expected: "184500.00",
      collected: "180780.00",
      shortfall: "4320.00",
      surplus: "600.00",
      lowCount: 6,
      extraCount: 1,
      linesToClose: 12,
      linesClosed: 10,
      linesTallied: 10,
    },
  },
  tally: { collecting: 2, tallied: 1, withExtra: 1, withLow: 1 },
};

const answers = (body: unknown = comparison): ApiAnswers => ({
  "/api/dashboards/sectors": { json: body },
});

const PATH = `/dashboard/sectors?date=${DATE}`;

test.describe("the sector comparison (US-081)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    test(`${role} sees every sector side by side, with the day's tally`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role, answers());
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Sector comparison" }),
      ).toBeVisible();
      await expect(shown(page, "23 Sep 2026")).toBeVisible();

      const table = page.getByRole("table");
      const row = table.getByRole("row", { name: /Triplicane/ });
      await expect(row.getByText("636", { exact: true })).toBeVisible();
      await expect(row.getByText("₹86,78,500.00")).toBeVisible();
      await expect(row.getByText("Tallied", { exact: true })).toBeVisible();
      await expect(
        table
          .getByRole("row", { name: /Mylapore/ })
          .getByText("3 of 5 lines tallied"),
      ).toBeVisible();

      // §19: "Tallied 1 of 2".
      const tally = page.locator('dl[aria-label="Collection status"]');
      await expect(tally.getByText("of 2").first()).toBeVisible();

      // The business line the rows add up to.
      await expect(
        shown(page, "2 active sectors · 12 lines · 1048 customers"),
      ).toBeVisible();
    });
  }

  test("a sector that collected less than expected shows its shortfall as critical", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    const table = page.getByRole("table");
    await expect(
      table
        .getByRole("row", { name: /Mylapore/ })
        .locator(".text-critical", { hasText: "₹4,320.00" }),
    ).toBeVisible();
    await expect(
      table.getByRole("row", { name: /Triplicane/ }).locator(".text-critical"),
    ).toHaveCount(0);
  });

  test("on a phone each sector is a card: the day's money, its lines, a bar and its tally (S-07b)", async ({
    page,
  }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "SUPER_ADMIN", answers());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);

    const cards = page.getByRole("list", { name: "Sectors compared" });
    const mylapore = cards
      .getByRole("listitem")
      .filter({ hasText: "Mylapore" });
    await expect(mylapore.getByText("₹4,320.00")).toHaveClass(/text-warning/);
    await expect(mylapore.getByText(/% collected/)).toBeVisible();
    await expect(
      cards
        .getByRole("listitem")
        .filter({ hasText: "Triplicane" })
        .getByText("Tallied", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      shown(page, "2 active sectors · 12 lines · 1048 customers"),
    ).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("a Senior is refused, and the comparison is never asked for", async ({
    page,
  }) => {
    let asked = 0;
    await signedInAs(page, "SENIOR", {
      "/api/dashboards/sectors": () => {
        asked += 1;
        return { json: comparison };
      },
    });
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, "The sector comparison is for Super Admins and Admins."),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    expect(asked).toBe(0);
  });

  test("before any sector or line exists it says so rather than a grid of zeros", async ({
    page,
  }) => {
    const zero = day("0.00", "0.00", "0.00", "0.00", "NO_COLLECTIONS", 0, 0);
    await signedInAs(
      page,
      "ADMIN",
      answers({
        ...comparison,
        setupNeeded: true,
        sectors: [],
        business: {
          structure: { sectors: 0, lines: 0, customers: 0 },
          totals: { accountAmount: "0.00", invested: "0.00", profit: "0.00" },
          today: { ...zero, tally: undefined },
        },
        tally: { collecting: 0, tallied: 0, withExtra: 0, withLow: 0 },
      }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, "There is no line to collect on yet"),
    ).toBeVisible();
    await expect(shown(page, "no sector had collections due")).toBeVisible();
  });

  test("sectors that could not be read are said so, never shown as zeros", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({ ...comparison, sectors: null, tally: null }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(page, /The sectors couldn’t be read just now/),
    ).toBeVisible();
  });
});

test.describe("the sector comparison at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(shown(page, "Triplicane")).toBeVisible();
      expect(
        await overflows(page),
        `the comparison scrolls sideways at ${name}`,
      ).toBe(false);
    });
  }
});
