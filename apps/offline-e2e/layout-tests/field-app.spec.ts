import { expect, type Page, test } from "@playwright/test";
import {
  addCalendarDays,
  parseCalendarDate,
  toBusinessDate,
} from "@repo/domain";

import { type ApiAnswers, signedInAs } from "./fake-api";

/**
 * The Junior's field app (J-01…J-08) in a real browser at the design width,
 * 360px. Same rule as the rest of this suite — **it writes nothing**: no
 * sign-in, and every `/api/…` request is answered inside the browser. A
 * collection recorded here is saved to the browser's IndexedDB and its send is
 * answered `503`, so it stays "Saved on phone"; nothing reaches a database.
 *
 * **This proves the screens, not the offline engine.** That a collection
 * survives no signal and is sent exactly once is proven against the real API
 * by `tests/offline.spec.ts`; the maths it shows is proven in
 * `apps/web/lib/offline/offline.spec.ts`.
 */

const PHONE = { width: 360, height: 780 };
const TODAY = toBusinessDate(new Date());
const YESTERDAY = addCalendarDays(parseCalendarDate(TODAY), -1);

/** Yesterday as the office has it: a collection, and a correction to it waiting. */
const entry = {
  id: "col-1",
  entryType: "ORIGINAL",
  status: "CONFIRMED",
  adjustsCollectionId: null,
  accountLoanId: "acc-1",
  accountCode: "ACC-2026-0091",
  customerId: "cus-lakshmi",
  customerName: "Lakshmi Ammal",
  lineId: "line-7",
  lineName: "Market Road",
  collectedByUserId: "user-layout-test",
  collectedByName: "Selvi M",
  businessDate: YESTERDAY,
  capturedAt: `${YESTERDAY}T05:30:00.000Z`,
  syncedAt: `${YESTERDAY}T05:31:00.000Z`,
  expectedAmount: "500.00",
  amount: "500.00",
  variance: "0.00",
  classification: "CORRECT",
  note: null,
};
const history = [
  // Today, as the office has it: a collection the phone already lists, and a
  // Senior's correction to yesterday's — dated today, the day it was asked.
  {
    ...entry,
    id: "col-today",
    businessDate: TODAY,
    capturedAt: `${TODAY}T05:30:00.000Z`,
  },
  {
    ...entry,
    id: "adj-today",
    entryType: "ADJUSTMENT",
    status: "PENDING_APPROVAL",
    adjustsCollectionId: "col-1",
    businessDate: TODAY,
    capturedAt: `${TODAY}T06:10:00.000Z`,
    expectedAmount: "0.00",
    amount: "10.00",
    variance: "10.00",
    classification: "CORRECT",
  },
  {
    ...entry,
    id: "adj-1",
    entryType: "ADJUSTMENT",
    status: "PENDING_APPROVAL",
    adjustsCollectionId: "col-1",
    expectedAmount: "0.00",
    amount: "-50.00",
    variance: "0.00",
    classification: "LOW",
  },
  entry,
];

/** One customer of the line's portfolio (J-09), due today unless told otherwise. */
const portfolioRow = (
  customerId: string,
  customerCode: string,
  name: string,
  outstandingTotal: string,
  overrides: Record<string, unknown> = {},
) => ({
  customerId,
  customerCode,
  name,
  address: `${name} Street`,
  mobile: "+919842155000",
  position: null,
  outstandingTotal,
  activeAccounts: 1,
  completedAccounts: 0,
  overdue: false,
  missedDays: 0,
  dueToday: true,
  paidToday: false,
  ...overrides,
});

/** An account as a Junior reads it: no invested amount, no profit. */
const loan = (
  id: string,
  accountCode: string,
  accountAmount: string,
  collectedAmount: string,
  isOverdue: boolean,
) => ({
  id,
  accountCode,
  customerId: "cus-ravi",
  customerName: "Ravi Shankar",
  lineId: "line-7",
  lineName: "Market Road",
  status: "ACTIVE",
  accountAmount,
  investedAmount: null,
  profitAmount: null,
  dailyAmount: "400.00",
  termDays: 30,
  collectionFrequency: "DAILY",
  disbursementDate: "2026-08-20",
  firstCollectionDate: "2026-08-21",
  targetCompletionDate: "2026-09-27",
  actualCompletionDate: null,
  collectedAmount,
  outstandingAmount: "2400.00",
  isOverdue,
});

const account = (
  id: string,
  code: string,
  expected: string,
  outstanding: string,
) => ({
  accountLoanId: id,
  accountCode: code,
  expectedAmount: expected,
  outstandingAmount: outstanding,
  dailyAmount: expected,
  daysRemaining: 13,
  collectedToday: null,
  includedKeys: [],
});

const route = {
  businessDate: TODAY,
  day: { kind: "WORKING" },
  lineId: "line-7",
  line: { code: "LN-07", name: "Market Road" },
  customers: [
    {
      customerId: "cus-lakshmi",
      customerCode: "CUS-00412",
      name: "Lakshmi Ammal",
      address: "12, Gandhi St, Ward 4",
      mobile: "+919842155012",
      accounts: [account("acc-1", "ACC-2026-0091", "500.00", "6500.00")],
    },
    {
      customerId: "cus-ravi",
      customerCode: "CUS-00587",
      name: "Ravi Shankar",
      address: "3/7 Market Road",
      mobile: "+919842155013",
      accounts: [
        account("acc-2", "ACC-2026-0114", "400.00", "2400.00"),
        account("acc-3", "ACC-2026-0152", "500.00", "2300.00"),
      ],
    },
    {
      customerId: "cus-meena",
      customerCode: "CUS-00874",
      name: "Meena Stores",
      address: "Bazaar Main Rd",
      mobile: "+919842155014",
      accounts: [account("acc-4", "ACC-2026-0077", "300.00", "4200.00")],
    },
  ],
};

const answers: ApiAnswers = {
  "/api/route": { json: route },
  // A search is a history read: today alone (the correction screen) has none;
  // the last month has yesterday's two entries and today's office rows.
  // Without one it is the phone's send — refused as unavailable, so it stays.
  "/api/collections": (url) =>
    !url.search
      ? { status: 503, json: { code: "UNAVAILABLE", message: "Try later." } }
      : url.searchParams.get("from") === TODAY
        ? { json: { data: [], nextCursor: null, hasMore: false } }
        : { json: { data: history, nextCursor: null, hasMore: false } },
  "/api/devices/sync-report": {
    json: { reportedAt: new Date().toISOString() },
  },
  "/api/notifications": {
    json: { data: [], nextCursor: null, hasMore: false, unreadCount: 0 },
  },
  "/api/lines/line-7/customer-portfolio": {
    json: {
      businessDate: TODAY,
      totals: {
        outstandingTotal: "13000.00",
        activeAccounts: 4,
        overdueCustomers: 1,
        collectedLastSevenDays: "12450.00",
      },
      customers: [
        portfolioRow("cus-lakshmi", "CUS-00412", "Lakshmi Ammal", "6500.00", {
          paidToday: true,
        }),
        portfolioRow("cus-ravi", "CUS-00587", "Ravi Shankar", "4700.00", {
          activeAccounts: 2,
          missedDays: 2,
        }),
        portfolioRow("cus-meena", "CUS-00874", "Meena Stores", "1800.00", {
          overdue: true,
        }),
        portfolioRow("cus-arun", "CUS-00633", "Arun Traders", "0.00", {
          activeAccounts: 0,
          completedAccounts: 1,
          dueToday: false,
        }),
      ],
    },
  },
  "/api/customers/cus-ravi": {
    json: {
      id: "cus-ravi",
      customerCode: "CUS-00587",
      name: "Ravi Shankar",
      mobile: "+919842155013",
      status: "ACTIVE",
      lineId: "line-7",
      lineName: "Market Road",
      sectorId: "sec-1",
      alternateMobile: null,
      address: "3/7 Market Road, Ward 4",
      notes: null,
      sectorName: "Chennai",
      references: [],
    },
  },
  "/api/customers/cus-ravi/overview": {
    json: {
      accounts: { active: 2, completed: 0, other: 0 },
      outstandingTotal: "4700.00",
      collectedTotal: "12300.00",
      overdueAccounts: 1,
      missedDays: 2,
      lastPaidOn: YESTERDAY,
      investedTotal: null,
      profitTotal: null,
      staff: { seniorName: "Murugan", juniorNames: ["Selvi M"] },
    },
  },
  "/api/accounts": {
    json: {
      data: [
        loan("acc-2", "ACC-2026-0114", "12000.00", "9600.00", false),
        loan("acc-3", "ACC-2026-0152", "5000.00", "2700.00", true),
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/accounts/acc-2/schedule": {
    json: {
      slots: [
        {
          sequence: 1,
          dueDate: YESTERDAY,
          expectedAmount: "400.00",
          status: "COLLECTED",
        },
        {
          sequence: 2,
          dueDate: TODAY,
          expectedAmount: "400.00",
          status: "PENDING",
        },
      ],
    },
  },
  "/api/accounts/acc-3/schedule": {
    json: {
      slots: [
        {
          sequence: 1,
          dueDate: YESTERDAY,
          expectedAmount: "500.00",
          status: "MISSED",
        },
        {
          sequence: 2,
          dueDate: TODAY,
          expectedAmount: "500.00",
          status: "PENDING",
        },
      ],
    },
  },
  "/api/customers/cus-ravi/collections": {
    json: {
      data: [
        {
          ...entry,
          accountLoanId: "acc-2",
          accountCode: "ACC-2026-0114",
          customerId: "cus-ravi",
          customerName: "Ravi Shankar",
          amount: "400.00",
          expectedAmount: "400.00",
        },
      ],
      nextCursor: null,
      hasMore: false,
    },
  },
  "/api/cash": {
    json: {
      items: [
        {
          lineId: "line-7",
          lineName: "Market Road",
          businessDate: TODAY,
          hop: "JUNIOR_TO_SENIOR",
          toHandOver: "8450.00",
          expenses: "0.00",
          receiver: { userId: "user-murugan", name: "Murugan" },
          pending: null,
        },
      ],
      officeReceivers: [],
      recent: [],
    },
  },
};

async function openFieldApp(
  page: Page,
  overrides: ApiAnswers = {},
): Promise<void> {
  await page.setViewportSize(PHONE);
  await signedInAs(page, "JUNIOR", { ...answers, ...overrides });
  await page.goto("/route");
  // The first visit compiles the page under `next dev`.
  await expect(page.getByTestId("route")).toBeVisible({ timeout: 30_000 });
}

async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows, `${where} scrolls sideways at 360px`).toBe(false);
}

const tab = (page: Page, name: string | RegExp) =>
  page
    .getByRole("navigation", { name: "Field app" })
    .getByRole("link", { name });

/**
 * Customers and Collections are reached from Home's menu tiles since the
 * bottom bar became J-01's Home, Route, Cash, Sync, Profile (2026-10-02).
 */
async function openFromMenu(page: Page, name: "Customers" | "Collections") {
  await tab(page, "Home").click();
  await page
    .getByRole("navigation", { name: "Menu" })
    .getByRole("link", { name })
    .click();
}

test.describe("the Junior's field app at 360px", () => {
  test("J-01: the route is a native home screen — progress, the line, customers to visit, five tabs", async ({
    page,
  }) => {
    await openFieldApp(page);

    await expect(
      page.getByRole("heading", { name: "Today’s route" }),
    ).toBeVisible();
    await expect(page.getByText("0 of 3 visited")).toBeVisible();
    await expect(page.getByText("LN-07")).toBeVisible();
    await expect(page.getByTestId("customer-CUS-00412")).toContainText(
      "₹500.00",
    );
    await expect(page.getByTestId("customer-CUS-00587")).toContainText(
      "2 accounts",
    );
    for (const name of ["Home", "Route", "Cash", /^Sync/, "Profile"])
      await expect(tab(page, name)).toBeVisible();
    await expect(tab(page, "Home")).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: /Online, 0 not sent/ }),
    ).toContainText("All sent");
    await noSidewaysScroll(page, "the route");
  });

  test("J-01 home (2026-10-02): the next door is one tap, and what is still on the phone is said plainly", async ({
    page,
  }) => {
    await openFieldApp(page);

    const progress = page.getByRole("region", { name: "Today’s progress" });
    await expect(progress.getByText("0/3")).toBeVisible();
    const menu = page.getByRole("navigation", { name: "Menu" });
    for (const name of ["Hand over", "Expense", "Sync", "Collections"])
      await expect(menu.getByRole("link", { name })).toBeVisible();

    // The first customer still to visit, in the Senior's order.
    await page
      .getByRole("link", { name: /^Next: Lakshmi Ammal · ₹500$/ })
      .click();
    const form = page.getByTestId("collect-ACC-2026-0091");
    await form.getByRole("button", { name: /^Confirm/ }).click();

    await expect(page.getByTestId("route")).toBeVisible();
    await expect(progress.getByText("1/3")).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Sync, 1 not sent" }),
    ).toBeVisible();
    await expect(
      page.getByText("1 collection is safe on this phone."),
    ).toBeVisible();
    // The next door has moved on to the next customer.
    await expect(
      page.getByRole("link", { name: /^Next: Lakshmi Ammal/ }),
    ).toHaveCount(0);
    await noSidewaysScroll(page, "the route home");
  });

  test("search and the To visit / Done filter narrow the list", async ({
    page,
  }) => {
    await openFieldApp(page);

    await page.getByPlaceholder("Search name, code or street").fill("bazaar");
    await expect(page.getByTestId("customer-CUS-00874")).toBeVisible();
    await expect(page.getByTestId("customer-CUS-00412")).toBeHidden();

    await page.getByRole("button", { name: "Clear search" }).click();
    const done = page.getByRole("button", { name: /^Done/ });
    await done.click();
    await expect(done).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Nobody visited yet.")).toBeVisible();
  });

  test("J-02: one tap records the expected amount, saves it on the phone and returns to the route", async ({
    page,
  }) => {
    await openFieldApp(page);

    await page.getByTestId("account-ACC-2026-0091").click();
    const form = page.getByTestId("collect-ACC-2026-0091");
    await expect(
      page.getByRole("heading", { name: "Lakshmi Ammal" }),
    ).toBeVisible();
    await expect(form.getByLabel("Amount collected (₹)")).toHaveValue("500.00");
    await expect(form.getByText("Exactly the expected amount.")).toBeVisible();
    await noSidewaysScroll(page, "the collect screen");

    await form.getByRole("button", { name: /^Confirm/ }).click();

    await expect(page.getByTestId("route")).toBeVisible();
    await expect(
      page.getByText(/^Saved on phone: ₹500\.00 from Lakshmi Ammal/),
    ).toBeVisible();
    await expect(page.getByTestId("account-ACC-2026-0091")).toHaveAttribute(
      "data-state",
      "SAVED",
    );
    await expect(page.getByTestId("unsynced-count")).toHaveText("1");
    await expect(page.getByText("1 of 3 visited")).toBeVisible();
  });

  test("J-02: an amount over the outstanding is refused on the phone, in words", async ({
    page,
  }) => {
    await openFieldApp(page);

    await page.getByTestId("account-ACC-2026-0091").click();
    const form = page.getByTestId("collect-ACC-2026-0091");
    await form.getByLabel("Amount collected (₹)").fill("9000");
    await form.getByRole("button", { name: /^Confirm/ }).click();

    await expect(
      form.getByText(
        "More than the outstanding ₹6,500.00. Collect at most that.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("collect")).toBeVisible();
  });

  test("J-02: two accounts are two forms, each with its own buttons (BR-01a)", async ({
    page,
  }) => {
    await openFieldApp(page);

    await page.getByTestId("account-ACC-2026-0114").click();
    await expect(page.getByText("Record each one separately")).toBeVisible();
    await expect(page.getByLabel("Amount collected (₹)")).toHaveCount(2);
    for (const code of ["ACC-2026-0114", "ACC-2026-0152"])
      await expect(
        page.getByTestId(`collect-${code}`).getByRole("button", {
          name: /^Confirm/,
        }),
      ).toBeVisible();

    await page.getByRole("button", { name: "Back to route" }).click();
    await expect(page.getByTestId("route")).toBeVisible();
  });

  test("J-02c: No payment asks first, in a bottom sheet", async ({ page }) => {
    await openFieldApp(page);

    await page.getByTestId("account-ACC-2026-0077").click();
    await page.getByRole("button", { name: "No payment — I visited" }).click();
    const sheet = page.getByRole("dialog", {
      name: "Record no payment from Meena Stores",
    });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Record no payment" }).click();

    await expect(
      page.getByText(/^Saved on phone: no payment from Meena Stores/),
    ).toBeVisible();
  });

  test("J-03 and J-08: Collections lists what was recorded; Profile refuses sign-out while it is on the phone", async ({
    page,
  }) => {
    await openFieldApp(page);
    await page.getByTestId("account-ACC-2026-0091").click();
    await page
      .getByTestId("collect-ACC-2026-0091")
      .getByRole("button", { name: /^Confirm/ })
      .click();
    await expect(page.getByTestId("route")).toBeVisible();

    await openFromMenu(page, "Collections");
    const recorded = page.getByTestId("collection-ACC-2026-0091");
    await expect(recorded).toContainText("Lakshmi Ammal");
    await expect(recorded).toContainText("As expected");
    await expect(recorded).toContainText("Saved on phone");
    await noSidewaysScroll(page, "Collections");

    await tab(page, "Profile").click();
    await expect(page.getByRole("heading", { name: "Selvi M" })).toBeVisible();
    await expect(page.getByText("Market Road").first()).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByText("1 collection is still on this phone."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/route#profile$/);
    await noSidewaysScroll(page, "Profile");
  });

  test("J-05: Cash counts notes with steppers and names the Senior on the button", async ({
    page,
  }) => {
    await openFieldApp(page);
    await tab(page, "Cash").click();

    await expect(page.getByText("To Murugan", { exact: true })).toBeVisible();
    const hand = page.getByRole("button", { name: /Hand ₹0\.00 to Murugan/ });
    await expect(hand).toBeDisabled();
    await page.getByRole("button", { name: "One more ₹500 notes" }).click();
    await page.getByRole("button", { name: "One more ₹500 notes" }).click();
    await expect(
      page.getByRole("button", { name: /Hand ₹1,000\.00 to Murugan/ }),
    ).toBeEnabled();
    await expect(page.getByText("₹7,450.00 short")).toBeVisible();
    await expect(page.getByLabel("Reason for difference")).toBeVisible();
    await noSidewaysScroll(page, "Cash");
  });

  test("US-061: a count that differs asks for the reason on the phone and sends nothing", async ({
    page,
  }) => {
    let handovers = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/handovers")
      )
        handovers += 1;
    });
    await openFieldApp(page);
    await tab(page, "Cash").click();
    await page.getByRole("button", { name: "One more ₹500 notes" }).click();

    await page
      .getByRole("button", { name: /Hand ₹500\.00 to Murugan/ })
      .click();
    const note = page.getByLabel("Reason for difference");
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByText("Say why the count differs before handing over."),
    ).toBeVisible();
    expect(handovers).toBe(0);

    await note.fill("₹7,450 left with the shop, collected tomorrow");
    await expect(note).not.toHaveAttribute("aria-invalid");
  });

  test("US-045: Collections shows earlier days from the office, with a correction still waiting", async ({
    page,
  }) => {
    await openFieldApp(page);
    await openFromMenu(page, "Collections");
    await page.getByRole("button", { name: "Show earlier days" }).click();

    const earlier = page.getByTestId("earlier-collections");
    await expect(earlier.getByTestId("history-col-1")).toContainText("₹500.00");
    const correction = earlier.getByTestId("history-adj-1");
    await expect(correction).toContainText("Correction");
    await expect(correction).toContainText("Waiting for approval");
    await expect(correction).toContainText("−₹50.00");

    // A Senior's correction asked for today still reaches the Junior; today's
    // own collection is not repeated, as the phone lists it above.
    const today = earlier.getByTestId("history-adj-today");
    await expect(today).toContainText("Correction");
    await expect(today).toContainText("Waiting for approval");
    await expect(today).toContainText("+₹10.00");
    await expect(earlier.getByTestId("history-col-today")).toHaveCount(0);
    await noSidewaysScroll(page, "earlier collections");
  });

  test("J-09: the Customers tab is the line's portfolio, in visiting order, with what stands out", async ({
    page,
  }) => {
    await openFieldApp(page);
    await openFromMenu(page, "Customers");

    await expect(page.getByText("₹13,000.00")).toBeVisible();
    await expect(page.getByTestId("portfolio-CUS-00412")).toContainText(
      "Paid today",
    );
    await expect(page.getByTestId("portfolio-CUS-00587")).toContainText(
      "Missed 2 days",
    );
    await expect(page.getByTestId("portfolio-CUS-00874")).toContainText(
      "Overdue",
    );
    await expect(page.getByTestId("portfolio-CUS-00633")).toContainText(
      "Completed",
    );

    await page.getByRole("button", { name: /^Overdue/ }).click();
    await expect(page.getByTestId("portfolio-CUS-00874")).toBeVisible();
    await expect(page.getByTestId("portfolio-CUS-00412")).toBeHidden();
    await noSidewaysScroll(page, "Customers");
  });

  test("J-10: a customer's portfolio — outstanding across accounts, each account's progress and fortnight, recent payments, and no margin", async ({
    page,
  }) => {
    await openFieldApp(page);
    await openFromMenu(page, "Customers");
    await page.getByTestId("portfolio-CUS-00587").click();

    const summary = page.getByTestId("portfolio-summary");
    await expect(summary).toContainText("₹4,700.00");
    await expect(summary).toContainText("across 2 active accounts");
    await expect(summary).toContainText("2 days");
    await expect(
      page.getByTestId("portfolio-account-ACC-2026-0114"),
    ).toContainText("80.0%");
    await expect(
      page.getByTestId("portfolio-account-ACC-2026-0152"),
    ).toContainText("Overdue");
    await expect(page.getByTestId("portfolio-payments")).toContainText(
      "₹400.00",
    );
    await expect(page.getByTestId("customer-portfolio")).not.toContainText(
      /invested|profit/i,
    );
    // Due today on the phone's route: recorded from here, straight to J-02.
    await page
      .getByRole("button", { name: "Record today’s collection" })
      .click();
    await expect(page.getByTestId("collect-ACC-2026-0114")).toBeVisible();
    await noSidewaysScroll(page, "the customer portfolio");
  });

  test("a long list draws twenty at a time as it scrolls, in the one page scroll", async ({
    page,
  }) => {
    const many = Array.from({ length: 45 }, (_, index) => {
      const code = `CUS-${String(index + 1).padStart(5, "0")}`;
      return portfolioRow(
        `cus-${index}`,
        code,
        `Customer ${index + 1}`,
        "100.00",
      );
    });
    await openFieldApp(page, {
      "/api/lines/line-7/customer-portfolio": {
        json: {
          businessDate: TODAY,
          totals: {
            outstandingTotal: "4500.00",
            activeAccounts: 45,
            overdueCustomers: 0,
            collectedLastSevenDays: "0.00",
          },
          customers: many,
        },
      },
    });
    await openFromMenu(page, "Customers");

    const cards = page.locator('[data-testid^="portfolio-CUS-"]');
    await expect(cards).toHaveCount(20);
    await expect(page.getByText("Showing 20 of 45")).toBeVisible();

    await page.getByText("Showing 20 of 45").scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(40);
    await page.getByText("Showing 40 of 45").scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(45);
    await expect(page.getByText(/^Showing \d+ of 45$/)).toBeHidden();

    // The page is the only thing that scrolls: no list has a scroll box.
    const nested = await page.evaluate(
      () =>
        [...document.querySelectorAll("main *")].filter((element) => {
          const style = getComputedStyle(element);
          return (
            /(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight
          );
        }).length,
    );
    expect(nested, "a list scrolls inside its own box").toBe(0);

    // A filter starts again from the top piece.
    await page.getByRole("button", { name: /^Due today/ }).click();
    await expect(cards).toHaveCount(20);
  });

  test("J-01b: with no signal the chip says Offline, a banner says the collections are safe, and refresh goes", async ({
    page,
    context,
  }) => {
    await openFieldApp(page);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(page.getByTestId("connection")).toHaveText("Offline");
    await expect(
      page.getByText(/^No signal\. Collections save on this phone/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh route" }),
    ).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Today’s route" }),
    ).toBeVisible();
    await noSidewaysScroll(page, "the offline route");
  });

  test("J-04: the sync chip opens Sync, and its back arrow returns", async ({
    page,
  }) => {
    await openFieldApp(page);
    await page
      .getByTestId("status-bar")
      .getByRole("button", { name: /not sent/ })
      .click();
    await expect(page.getByTestId("all-synced")).toContainText(
      "Everything is sent to the office",
    );
    await page.getByRole("button", { name: "Back to route" }).click();
    await expect(page.getByTestId("route")).toBeVisible();
  });
});

test.describe("J-11 field expense (ADR-0018) at 360px", () => {
  const fieldExpense = {
    id: "exp-1",
    category: { id: "cat-fuel", name: "Fuel & travel" },
    amount: "50.00",
    businessDate: TODAY,
    note: "Petrol for the round",
    paidFrom: "CASH_IN_HAND",
    from: { bankAccountId: null, name: "Ravi's cash" },
    spender: { userId: "user-junior", name: "Ravi" },
    line: { id: "line-7", name: "Market Road" },
    status: "PENDING",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    recordedBy: { userId: "user-junior", name: "Ravi" },
    createdAt: "2026-09-24T05:00:00.000Z",
    canDecide: false,
  };
  const expenseAnswers: ApiAnswers = {
    "/api/expense-categories": {
      json: {
        data: [{ id: "cat-fuel", name: "Fuel & travel", isActive: true }],
      },
    },
    "/api/expenses": {
      json: {
        data: [
          {
            ...fieldExpense,
            id: "exp-0",
            amount: "30.00",
            status: "REJECTED",
            decisionNote: "Tea is not a business expense",
          },
        ],
        nextCursor: null,
        hasMore: false,
        total: 1,
        approvedTotal: "0.00",
      },
    },
  };

  test("Cash opens the expense screen; the Junior sends petrol for approval and sees why an earlier one was rejected", async ({
    page,
  }) => {
    await openFieldApp(page, expenseAnswers);
    // After the fake API, so this route wins for the write.
    const sent: unknown[] = [];
    await page.route("**/api/expenses/field", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: fieldExpense });
    });
    await tab(page, "Cash").click();
    await page
      .getByRole("button", {
        name: "Spent from the cash? Record a field expense",
      })
      .click();
    await expect(page.getByTestId("expense")).toBeVisible();

    const mine = page.getByRole("list", { name: "Field expenses" });
    await expect(mine.getByText("Rejected — hand it over")).toBeVisible();
    await expect(mine.getByText("Tea is not a business expense")).toBeVisible();

    await page
      .getByRole("radiogroup", { name: "Expense type" })
      .getByRole("radio", { name: "Fuel & travel" })
      .click();
    await page.getByRole("button", { name: "₹50" }).click();
    await expect(page.getByLabel("Amount (₹)")).toHaveValue("50");
    // The handover after approval, from today's cash position.
    const preview = page.getByRole("note", { name: "Handover after approval" });
    await expect(preview.getByText("₹8,450.00")).toBeVisible();
    await expect(preview.getByText("₹8,400.00")).toBeVisible();
    await page.getByLabel("Note").fill("Petrol for the round");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText("₹50.00 for fuel & travel sent for approval."),
    ).toBeVisible();
    expect(sent).toEqual([
      { categoryId: "cat-fuel", amount: "50", note: "Petrol for the round" },
    ]);
    await noSidewaysScroll(page, "the expense screen");
  });

  test("an amount that is not money is refused on the phone and nothing is sent", async ({
    page,
  }) => {
    await openFieldApp(page, expenseAnswers);
    let posts = 0;
    await page.route("**/api/expenses/field", async (route) => {
      posts += 1;
      await route.fulfill({ status: 201, json: fieldExpense });
    });
    await page.goto("/route#expense");
    await page.getByRole("radio", { name: "Fuel & travel" }).click();
    await page.getByLabel("Amount (₹)").fill("fifty");
    await page.getByLabel("Note").fill("Petrol");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText("Enter the amount in rupees, like 50 or 49.50."),
    ).toBeVisible();
    expect(posts).toBe(0);
  });

  test("an approved expense shows as taken off what the Junior hands over", async ({
    page,
  }) => {
    await openFieldApp(page, {
      "/api/cash": {
        json: {
          items: [
            {
              lineId: "line-7",
              lineName: "Market Road",
              businessDate: TODAY,
              hop: "JUNIOR_TO_SENIOR",
              toHandOver: "8400.00",
              expenses: "50.00",
              receiver: { userId: "user-murugan", name: "Murugan" },
              pending: null,
            },
          ],
          officeReceivers: [],
          recent: [],
        },
      },
    });
    await tab(page, "Cash").click();
    await expect(
      page.getByText("₹50.00 approved expenses taken off"),
    ).toBeVisible();
    await expect(page.getByText("₹8,400.00", { exact: true })).toBeVisible();
  });
});
