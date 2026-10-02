import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-23, the collection report (US-086), at the three widths. **Writes
 * nothing**: no sign-in, and every figure is a fixture shaped by
 * `reportContract.getCollection`. That the figures and BR-08's classes are
 * right is proven at the API (`apps/api/test/reports/`); what is proven here
 * is that the screen draws them, and that a line that collected less than it
 * was expected to shows its variance **signed**, pointing down.
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

const tally = (count: number, amount: string) => ({ count, amount });

/** ₹4,320 short over the range, with two missed visits. */
const mylapore = {
  lineId: "line-1",
  code: "LIN-00001",
  name: "Mylapore East",
  isActive: true,
  sectorId: "sec-1",
  sectorCode: "SEC-00001",
  sectorName: "Mylapore",
  collections: {
    expected: "112350.00",
    collected: "108030.00",
    pending: "4710.00",
    extra: "390.00",
    variance: "-4320.00",
    missed: 2,
  },
  classification: {
    recorded: 540,
    amount: "108030.00",
    correct: tally(512, "102400.00"),
    low: tally(19, "2280.00"),
    extra: tally(3, "3350.00"),
    noPayment: tally(6, "0.00"),
    adjusted: tally(0, "0.00"),
  },
};

/** Over what was expected: a variance that points up. */
const triplicane = {
  ...mylapore,
  lineId: "line-2",
  code: "LIN-00002",
  name: "Triplicane High Road",
  sectorId: "sec-2",
  sectorCode: "SEC-00002",
  sectorName: "Triplicane",
  collections: {
    expected: "76800.00",
    collected: "77250.00",
    pending: "0.00",
    extra: "450.00",
    variance: "450.00",
    missed: 0,
  },
  classification: {
    recorded: 384,
    amount: "77250.00",
    correct: tally(381, "76200.00"),
    low: tally(0, "0.00"),
    extra: tally(3, "1050.00"),
    noPayment: tally(0, "0.00"),
    adjusted: tally(0, "0.00"),
  },
};

const report = {
  from: "2026-09-01",
  to: "2026-09-23",
  generatedAt: "2026-09-23T10:00:00.000Z",
  lines: [mylapore, triplicane],
  totals: {
    lines: 2,
    collections: {
      expected: "189150.00",
      collected: "185280.00",
      pending: "4710.00",
      extra: "840.00",
      variance: "-3870.00",
      missed: 2,
    },
    classification: {
      recorded: 924,
      amount: "185280.00",
      correct: tally(893, "178600.00"),
      low: tally(19, "2280.00"),
      extra: tally(6, "4400.00"),
      noPayment: tally(6, "0.00"),
      adjusted: tally(1, "-200.00"),
    },
  },
};

const answers = (body: unknown = report): ApiAnswers => ({
  "/api/reports/collection": { json: body },
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
  "/api/staff": { json: { data: [], nextCursor: null, hasMore: false } },
});

/** An explicit range, so the screen never depends on today's date. */
const PATH = "/reports/collection?from=2026-09-01&to=2026-09-23";

test.describe("the collection report (S-23, US-086)", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN"] as const) {
    test(`${role} sees each line's expected against collected, and its entries by class`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, role, answers());
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(
        page.getByRole("heading", { name: "Collection report" }),
      ).toBeVisible();
      await expect(shown(page, "Mylapore East")).toBeVisible();
      await expect(shown(page, "Triplicane High Road")).toBeVisible();

      const totals = page.locator('dl[aria-label="This period"]');
      await expect(totals.getByText("₹1,89,150.00")).toBeVisible();
      await expect(totals.getByText("₹1,85,280.00")).toBeVisible();

      // BR-08's four classes are counted on the row.
      const row = page
        .getByRole("table")
        .getByRole("row", { name: /Mylapore East/ });
      await expect(row.getByText("512", { exact: true })).toBeVisible();
      await expect(row.getByText("19", { exact: true })).toBeVisible();
      // A correction that landed in the range is kept apart, signed.
      await expect(shown(page, /1 · −₹200\.00/)).toBeVisible();
    });
  }

  test("a line that collected less than expected shows its variance signed and critical", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers());
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    const table = page.getByRole("table");
    const short = table.getByRole("row", { name: /Mylapore East/ });
    await expect(
      short.locator(".text-critical", { hasText: "−₹4,320.00" }),
    ).toBeVisible();

    // Over is signed the other way, and not in the critical tone.
    const over = table.getByRole("row", { name: /Triplicane High Road/ });
    await expect(over.getByText("+₹450.00")).toBeVisible();
    await expect(over.locator(".text-critical")).toHaveCount(0);

    // The period's total says how far below expected it came.
    await expect(
      page
        .locator('dl[aria-label="This period"]')
        .getByText("−₹3,870.00 against expected"),
    ).toBeVisible();
  });

  test("a Senior sees their own line, with no sector or line filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "SENIOR", answers({ ...report, lines: [mylapore] }));
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      shown(
        page,
        "What your line collected against what was expected, and how every entry classified.",
      ),
    ).toBeVisible();
    await expect(shown(page, "Mylapore East")).toBeVisible();
    await expect(page.getByLabel("Sector")).toHaveCount(0);
  });

  test("a Senior with no line today is told so instead of an empty table", async ({
    page,
  }) => {
    await signedInAs(
      page,
      "SENIOR",
      answers({ ...report, lines: [], totals: null }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "No line assigned to you today")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("with no lines yet an Admin is told so", async ({ page }) => {
    await signedInAs(
      page,
      "ADMIN",
      answers({ ...report, lines: [], totals: null }),
    );
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, "No lines yet")).toBeVisible();
  });
});

test.describe("the collection report at every width", () => {
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
