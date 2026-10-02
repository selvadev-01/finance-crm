import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-25, the discrepancy report (M12, BR-17), at the three widths the backlog
 * asks for. **Writes nothing**: no sign-in, so no permanent `LOGIN` row, and
 * the rows are fixtures — a real short day would mean real collections and a
 * real handover, both permanent.
 *
 * That the figures are right is proven at the API, in
 * `apps/api/test/reports/`. What is proven here is that the screen shows a
 * shortage as a shortage: **signed**, apart from Over, and never as an
 * absolute value — which way the difference points is BR-17's whole question.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

/** ₹4,300 counted against ₹4,320 recorded: one ₹20 note short (US-061). */
const short = {
  businessDate: "2026-09-18",
  lineId: "line-1",
  lineCode: "LN-07",
  lineName: "Mylapore East",
  sectorId: "sec-1",
  sectorName: "Mylapore",
  collectedByUserId: "user-junior",
  collectedByName: "Meena R",
  collected: "4320.00",
  cash: {
    handedOver: "4300.00",
    acknowledged: "4300.00",
    awaiting: "0.00",
    expenses: "0.00",
    difference: "-20.00",
    state: "SHORT" as const,
    handovers: [
      {
        handoverId: "ho-1",
        status: "ACKNOWLEDGED" as const,
        toUserId: "user-senior",
        toName: "Karthik R",
        declared: "4300.00",
        recorded: "4320.00",
        difference: "-20.00",
        note: "One 20 note missing at the count",
        disputeNote: null,
        createdAt: "2026-09-18T12:30:00.000Z",
        acknowledgedAt: "2026-09-18T12:45:00.000Z",
      },
    ],
  },
  dayCloseStatus: "CLOSED" as const,
};

/** A day that balances, so the screen has to keep the two apart. */
const tallied = {
  ...short,
  businessDate: "2026-09-17",
  collectedByName: "Suresh P",
  collectedByUserId: "user-junior-2",
  collected: "3000.00",
  cash: {
    handedOver: "3000.00",
    acknowledged: "3000.00",
    awaiting: "0.00",
    expenses: "0.00",
    difference: "0.00",
    state: "TALLIED" as const,
    handovers: [],
  },
  dayCloseStatus: "TALLIED" as const,
};

const report = {
  data: [short, tallied],
  nextCursor: null,
  hasMore: false,
  from: "2026-09-14",
  to: "2026-09-20",
  generatedAt: "2026-09-20T10:00:00.000Z",
  summary: {
    rows: 2,
    lines: 1,
    days: 2,
    collected: "7320.00",
    cash: {
      handedOver: "7300.00",
      acknowledged: "7300.00",
      awaiting: "0.00",
      expenses: "0.00",
      short: "20.00",
      over: "0.00",
      net: "-20.00",
      unresolved: 1,
    },
  },
};

const answers: ApiAnswers = {
  "/api/reports/discrepancy": { json: report },
  "/api/sectors": {
    json: {
      data: [{ sectorId: "sec-1", code: "SEC-01", name: "Mylapore" }],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/staff": { json: { data: [], nextCursor: null, hasMore: false } },
};

/** An explicit range, so the screen never depends on today's date. */
const PATH = "/reports/discrepancy?from=2026-09-14&to=2026-09-20&show=all";

test.describe("the discrepancy report (S-25, BR-17)", () => {
  test("shows a shortage signed, and keeps Short apart from Over", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers);
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Cash discrepancies" }),
    ).toBeVisible();

    // The set totals: Short and Over are separate figures, never netted into
    // one, so one line's shortage cannot hide another's surplus.
    // `StatGrid` is a `<dl>` carrying the label, which has no ARIA role to
    // query by — so the element itself is the scope.
    const totals = page.locator('dl[aria-label="This period"]');
    // Exact: "Over" is a substring of "Handed over", and the labels are
    // uppercased by CSS, not in the markup.
    await expect(totals.getByText("Short", { exact: true })).toBeVisible();
    await expect(totals.getByText("Over", { exact: true })).toBeVisible();

    // The row itself: who is answerable, and a difference that points down.
    await expect(shown(page, "Meena R")).toBeVisible();
    await expect(shown(page, /−\s?₹?20|-\s?₹?20/)).toBeVisible();
    // The day that balanced is still listed, and named as tallied.
    await expect(shown(page, "Suresh P")).toBeVisible();
  });

  test("says every day tallied rather than showing an empty table", async ({
    page,
  }) => {
    await signedInAs(page, "ADMIN", {
      ...answers,
      "/api/reports/discrepancy": {
        json: {
          ...report,
          data: [],
          summary: {
            ...report.summary,
            rows: 0,
            days: 0,
            cash: { ...report.summary.cash, short: "0.00", unresolved: 0 },
          },
        },
      },
    });
    await page.goto("/reports/discrepancy?from=2026-09-14&to=2026-09-20");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Every day has tallied")).toBeVisible();
  });

  test("a Senior sees it described as their own line's", async ({ page }) => {
    await signedInAs(page, "SENIOR", answers);
    await page.goto(PATH);
    await page.waitForLoadState("networkidle");

    await expect(shown(page, /your line’s Juniors collected/i)).toBeVisible();
  });
});

test.describe("at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`the report fits a ${name} without sideways scrolling`, async ({
      page,
    }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers);
      await page.setViewportSize(viewport);
      await page.goto(PATH);
      await page.waitForLoadState("networkidle");

      await expect(shown(page, "Meena R")).toBeVisible();
      // The table is allowed its own horizontal scroller; the page is not.
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows, `the report scrolls sideways at ${name}`).toBe(false);
    });
  }
});

/**
 * The Export menu (M12), on this report as the example of all ten screens
 * that carry it — one component, `components/export-menu.tsx`. The file route
 * is answered here with bytes and a filename; building the files is proven at
 * the API (`apps/api/test/exports/`).
 */
test.describe("the Export menu (M12)", () => {
  const FILES = [
    ["Excel (.xlsx)", "xlsx", "discrepancies-2026-09-14-to-2026-09-20.xlsx"],
    ["CSV", "csv", "discrepancies-2026-09-14-to-2026-09-20.csv"],
    ["PDF", "pdf", "discrepancies-2026-09-14-to-2026-09-20.pdf"],
  ] as const;

  for (const [item, format, filename] of FILES) {
    test(`${item} asks for this view's rows as ${format} and saves the file under the server's name`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signedInAs(page, "ADMIN", answers);
      const asked: URL[] = [];
      await page.route(
        "**/api/exports/reports/discrepancy**",
        async (route) => {
          asked.push(new URL(route.request().url()));
          await route.fulfill({
            status: 200,
            body: "file bytes",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        },
      );
      await page.goto(PATH);

      await page.getByRole("button", { name: "Export" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: item }).click();

      expect((await download).suggestedFilename()).toBe(filename);
      expect(asked).toHaveLength(1);
      expect(asked[0]!.searchParams.get("format")).toBe(format);
      expect(asked[0]!.searchParams.get("from")).toBe("2026-09-14");
      expect(asked[0]!.searchParams.get("to")).toBe("2026-09-20");
    });
  }

  test("a refused export says so instead of saving anything", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers);
    await page.route("**/api/exports/reports/discrepancy**", (route) =>
      route.fulfill({
        status: 403,
        json: {
          code: "PERMISSION_DENIED",
          message: "You do not have permission to do that.",
          correlationId: "req_test",
        },
      }),
    );
    let downloads = 0;
    page.on("download", () => {
      downloads += 1;
    });
    await page.goto(PATH);

    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "PDF" }).click();

    await expect(page.getByText("Couldn’t export").first()).toBeVisible();
    expect(downloads).toBe(0);
  });

  test("the menu is off while the range is invalid, as the API would refuse it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/reports/discrepancy?from=2026-09-20&to=2026-09-14");

    await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
