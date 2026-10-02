import { expect, type Page, test } from "@playwright/test";

import { type Role, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-05 — a line's day close (US-060) in a real browser. Writes nothing: the
 * day is a fixture and a close is captured and answered here. Who may close
 * — `canClose` — and what closing does to the books are proven over the API
 * (`apps/api/test/cash`); this proves what the closer is shown: the money,
 * each Junior's phone, what needs a look, and the cash that came in.
 */

const COMPUTER = { width: 1280, height: 900 };
const DATE = "2026-09-23";
const URL_ = `/lines/line-7/day-closes/${DATE}`;

const denominations = [
  { denomination: 500, count: 8, subtotal: "4000.00" },
  { denomination: 100, count: 3, subtotal: "300.00" },
];

const handover = (overrides: Record<string, unknown> = {}) => ({
  id: "handover-1",
  hop: "JUNIOR_TO_SENIOR",
  lineId: "line-7",
  lineName: "Mylapore East",
  businessDate: DATE,
  fromUserId: "user-selvi",
  fromName: "Selvi M",
  toUserId: "user-karthik",
  toName: "Karthik R",
  declaredAmount: "4300.00",
  systemAmount: "4320.00",
  discrepancy: "-20.00",
  status: "ACKNOWLEDGED",
  note: "One ₹20 note short",
  disputeNote: null,
  createdAt: "2026-09-23T12:30:00.000Z",
  acknowledgedAt: "2026-09-23T12:45:00.000Z",
  denominations,
  canAcknowledge: false,
  canDispute: false,
  ...overrides,
});

const day = (overrides: Record<string, unknown> = {}) => ({
  lineId: "line-7",
  lineName: "Mylapore East",
  businessDate: DATE,
  day: { kind: "WORKING" },
  status: "OPEN",
  expectedTotal: "4800.00",
  collectedTotal: "4320.00",
  cashReceivedTotal: "4300.00",
  expenseTotal: "0.00",
  // cash received − collected
  discrepancy: "-20.00",
  closedAt: null,
  closedByName: null,
  reopenReason: null,
  juniors: [
    {
      userId: "user-selvi",
      name: "Selvi M",
      collectedAmount: "4320.00",
      entries: 11,
      sync: "SENT",
      unsentCount: 0,
      reportedAt: "2026-09-23T12:20:00.000Z",
    },
    {
      userId: "user-anbu",
      name: "Anbu Selvan",
      collectedAmount: "0.00",
      entries: 0,
      sync: "UNSENT",
      unsentCount: 3,
      reportedAt: "2026-09-23T11:00:00.000Z",
    },
  ],
  exceptions: [
    {
      kind: "LOW",
      collectionId: "col-2",
      accountLoanId: "acc-2",
      accountCode: "ACC-2026-00418",
      customerName: "Parvathi Ramasamy",
      expectedAmount: "500.00",
      amount: "400.00",
      collectedByName: "Selvi M",
    },
    {
      kind: "NOT_VISITED",
      collectionId: null,
      accountLoanId: "acc-3",
      accountCode: "ACC-2026-00431",
      customerName: "Meenakshi Sundaram",
      expectedAmount: "380.00",
      amount: null,
      collectedByName: null,
    },
  ],
  handovers: [handover()],
  canClose: true,
  canReopen: false,
  ...overrides,
});

const noCash = { items: [], officeReceivers: [], recent: [] };

/** The day as `role` reads it; any POST under it is captured and answered. */
async function showDay(page: Page, role: Role, view: Record<string, unknown>) {
  const sent: { path: string; body: unknown }[] = [];
  await signedInAs(page, role, {
    [`/api/lines/line-7/day-closes/${DATE}`]: { json: view },
    "/api/cash": { json: noCash },
  });
  await page.route("**/api/lines/line-7/day-closes/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fallback();
    sent.push({
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    await route.fulfill({ json: { ...view, status: "CLOSED" } });
  });
  return sent;
}

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

/** A figure's tile, found by its label (`<dt>`). */
const stat = (page: Page, label: string) =>
  page
    .locator("div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .filter({ has: page.locator("dd") })
    .last();

test.describe("the day close (S-05)", () => {
  for (const [who, role] of [
    ["an Admin", "ADMIN"],
    ["the line's Senior", "SENIOR"],
  ] as const) {
    test(`shows the day's money, each Junior's phone, what needs a look and the handovers — ${who}`, async ({
      page,
    }) => {
      await withSavedLayout(page, "desktop");
      await showDay(page, role, day());
      await page.setViewportSize(COMPUTER);
      await page.goto(URL_);

      await expect(
        page.getByRole("heading", { name: "Day close · 23 Sep 2026" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(visible(page, "₹4,800.00")).toBeVisible();
      await expect(visible(page, "₹4,320.00")).toBeVisible();

      // Juniors and their phones
      await expect(visible(page, "Anbu Selvan")).toBeVisible();
      await expect(visible(page, "All sent")).toBeVisible();
      await expect(visible(page, /Not sent/)).toBeVisible();
      await expect(visible(page, /· 3/)).toBeVisible();

      // Needs a look
      await expect(visible(page, "Parvathi Ramasamy")).toBeVisible();
      await expect(visible(page, "Not visited yet")).toBeVisible();

      // Cash handovers
      const card = page.getByTestId("handover");
      await expect(card.getByText("Selvi M → Karthik R")).toBeVisible();
      await expect(card.getByText("₹4,300.00")).toBeVisible();
      await expect(card.getByText("−₹20.00 short")).toBeVisible();
      await expect(card.getByText("Acknowledged")).toBeVisible();
    });
  }

  test("expected above collected is a shortfall, shown unsigned under that name", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showDay(page, "ADMIN", day());
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(visible(page, "Shortfall")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Surplus", { exact: true })).toHaveCount(0);
    await expect(stat(page, "Shortfall")).toContainText("₹480.00");
    await expect(stat(page, "Shortfall")).not.toContainText("−");
  });

  test("collected above expected is a surplus", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await showDay(
      page,
      "ADMIN",
      day({ collectedTotal: "4900.00", cashReceivedTotal: "4900.00" }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(visible(page, "Surplus")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Shortfall", { exact: true })).toHaveCount(0);
    await expect(stat(page, "Surplus")).toContainText("₹100.00");
  });

  test("cash received short of collected is signed and named short", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showDay(page, "ADMIN", day());
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(stat(page, "Cash received")).toContainText("₹4,300.00", {
      timeout: 30_000,
    });
    await expect(stat(page, "Cash received")).toContainText("−₹20.00 short");
  });

  test("before any handover is acknowledged, cash received is not called short", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showDay(
      page,
      "ADMIN",
      day({
        cashReceivedTotal: "0.00",
        discrepancy: "-4320.00",
        handovers: [
          handover({
            status: "PENDING",
            acknowledgedAt: null,
            canDispute: true,
          }),
        ],
      }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(visible(page, "not handed over yet")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("−₹4,320.00 short")).toHaveCount(0);
    await expect(
      page.getByTestId("handover").getByRole("button", { name: "Dispute" }),
    ).toBeVisible();
  });

  test("Close is offered when the API allows it, and names what closing does", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    const sent = await showDay(page, "SENIOR", day());
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await page.getByRole("button", { name: "Close day" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Close Mylapore East for 23 Sep 2026",
    });
    await expect(
      dialog.getByText(
        "Collected ₹4,320.00 against ₹4,800.00 expected. 1 unvisited slot is marked missed. A collection that arrives later reopens the day.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("Anbu Selvan has not confirmed everything is sent."),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Close day" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { path: `/api/lines/line-7/day-closes/${DATE}/close`, body: {} },
    ]);
  });

  test("a closed day offers no Close, and says who closed it", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showDay(
      page,
      "SENIOR",
      day({
        status: "CLOSED",
        closedAt: "2026-09-23T13:00:00.000Z",
        closedByName: "Karthik R",
        canClose: false,
      }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(visible(page, "closed by Karthik R")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Close day" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  });

  test("a day with nothing in it says so in each section", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await showDay(
      page,
      "ADMIN",
      day({
        day: { kind: "HOLIDAY", name: "Vinayaka Chathurthi" },
        expectedTotal: "0.00",
        collectedTotal: "0.00",
        cashReceivedTotal: "0.00",
        discrepancy: "0.00",
        juniors: [],
        exceptions: [],
        handovers: [],
      }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto(URL_);

    await expect(
      visible(page, "Holiday: Vinayaka Chathurthi. No collections are due."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      visible(page, "No Junior worked this line on this day."),
    ).toBeVisible();
    await expect(
      visible(page, "Every collection matched what was expected."),
    ).toBeVisible();
    await expect(visible(page, "No handovers yet.")).toBeVisible();
  });

  test("another line's day reads as not found", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", { "/api/cash": { json: noCash } });
    await page.setViewportSize(COMPUTER);
    await page.goto(`/lines/line-9/day-closes/${DATE}`);

    await expect(visible(page, "Line not found")).toBeVisible({
      timeout: 30_000,
    });
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await showDay(page, "ADMIN", day());
      await page.setViewportSize(viewport);
      await page.goto(URL_);

      await expect(visible(page, "Parvathi Ramasamy")).toBeVisible({
        timeout: 30_000,
      });
      expect(await overflows(page), `S-05 at ${name}`).toBe(false);
    });
  }
});
