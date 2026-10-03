import { expect, type Page, test } from "@playwright/test";

import {
  type ApiAnswers,
  type ConsoleRole,
  signedInAs,
  withSavedLayout,
} from "./fake-api";

/**
 * ADR-0015's console re-layout: the three dashboards — S-07 (Super Admin),
 * S-20 (Admin), S-19 (Senior) — at the tablet width the backlog left
 * unchecked, beside phone and computer; and the sidebar rail opening over the
 * page on hover and on keyboard focus, which had only been tried by hand.
 * **Writes nothing**: every figure is a fixture shaped by the contract. That
 * the figures are right is proven at the API (`apps/api/test/dashboards/`).
 */

const DATE = "2026-09-23";
const AT = "2026-09-23T10:00:00.000Z";
const WORKING = { kind: "WORKING" } as const;

const overview = {
  businessDate: DATE,
  day: WORKING,
  generatedAt: AT,
  setupNeeded: false,
  today: {
    expected: "184500.00",
    collected: "176320.00",
    pending: "9380.00",
    extra: "1200.00",
    lowCount: 14,
    extraCount: 3,
  },
  structure: { sectors: 3, lines: 12, customers: 1048 },
  accounts: { active: 986, completed: 412 },
  totals: {
    accountAmount: "18450000.00",
    invested: "15682500.00",
    profit: "2767500.00",
  },
  sectors: [
    {
      sectorId: "sec-1",
      code: "SEC-00001",
      name: "Mylapore",
      lineCount: 5,
      expected: "80250.00",
      collected: "78100.00",
      shortfall: "2750.00",
      surplus: "600.00",
      lowCount: 6,
      extraCount: 1,
      linesToClose: 5,
      linesClosed: 4,
      linesTallied: 3,
      tally: "OPEN",
    },
    {
      sectorId: "sec-2",
      code: "SEC-00002",
      name: "Triplicane",
      lineCount: 7,
      expected: "104250.00",
      collected: "98220.00",
      shortfall: "6630.00",
      surplus: "600.00",
      lowCount: 8,
      extraCount: 2,
      linesToClose: 7,
      linesClosed: 7,
      linesTallied: 7,
      tally: "TALLIED",
    },
  ],
  tally: { collecting: 2, tallied: 1, withExtra: 2, withLow: 2 },
};

const lineToday = (n: number) => ({
  lineId: `line-${n}`,
  code: `LIN-0000${n}`,
  name: ["Mylapore East", "Luz Corner", "Triplicane High Road"][n - 1]!,
  isActive: true,
  sectorId: "sec-1",
  sectorCode: "SEC-00001",
  sectorName: "Mylapore",
  day: WORKING,
  status: n === 1 ? "OPEN" : "TALLIED",
  expected: "16050.00",
  collected: n === 1 ? "14820.00" : "16050.00",
  missedCount: n === 1 ? 2 : 0,
  lowCount: n === 1 ? 3 : 0,
  extraCount: 0,
  seniorName: "Karthik R",
  juniorCount: 2,
  activeAccounts: 84,
});

const operations = {
  businessDate: DATE,
  day: WORKING,
  generatedAt: AT,
  today: {
    expected: "48150.00",
    collected: "46920.00",
    pending: "1230.00",
    extra: "0.00",
    lowCount: 3,
    extraCount: 0,
    linesToClose: 3,
    linesNotClosed: 1,
  },
  pendingApprovals: { total: 2, awaitingYou: 1 },
  customers: { new: 4, active: 252 },
  accounts: { total: 310, active: 252, completed: 58 },
  investment: { invested: "4012500.00", profit: "708100.00" },
  sectors: [
    {
      sectorId: "sec-1",
      code: "SEC-00001",
      name: "Mylapore",
      lineCount: 3,
      activeAccounts: 252,
      expected: "48150.00",
      collected: "46920.00",
    },
  ],
  lines: [lineToday(1), lineToday(2), lineToday(3)],
  attention: [
    {
      kind: "DAY_NOT_CLOSED",
      lineId: "line-1",
      lineCode: "LIN-00001",
      lineName: "Mylapore East",
      status: "OPEN",
    },
    { kind: "PENDING_APPROVALS", count: 2, awaitingYou: 1 },
  ],
};

const watched = (n: number, daysOverdue: number) => ({
  accountLoanId: `acc-${n}`,
  accountCode: `ACC-2026-0041${n}`,
  customerId: `cus-${n}`,
  customerName: ["Meenakshi Sundaram", "Ravi Shankar", "Lakshmi Narayanan"][
    n - 1
  ]!,
  dailyAmount: "200.00",
  outstanding: daysOverdue ? "1400.00" : "600.00",
  targetCompletionDate: daysOverdue ? "2026-09-10" : "2026-09-26",
  daysOverdue,
});

const line = {
  state: "LINE",
  businessDate: DATE,
  generatedAt: AT,
  line: {
    lineId: "line-1",
    code: "LIN-00001",
    name: "Mylapore East",
    sectorName: "Mylapore",
  },
  day: {
    day: WORKING,
    status: "OPEN",
    closedAt: null,
    closedByName: null,
    expected: "16050.00",
    collected: "14820.00",
    shortfall: "1230.00",
    surplus: "0.00",
    cashReceived: "9600.00",
    discrepancy: "-5220.00",
    cashHandedOver: true,
    handovers: { waiting: 1, disputed: 0 },
    juniors: [
      {
        userId: "user-junior",
        name: "Selvi M",
        collectedAmount: "9600.00",
        entries: 42,
        sync: "SENT",
        unsentCount: 0,
        reportedAt: AT,
      },
      {
        userId: "user-junior-2",
        name: "Suresh P",
        collectedAmount: "5220.00",
        entries: 25,
        sync: "UNSENT",
        unsentCount: 3,
        reportedAt: AT,
      },
    ],
    exceptions: [
      {
        kind: "LOW",
        collectionId: "col-9",
        accountLoanId: "acc-9",
        accountCode: "ACC-2026-00419",
        customerName: "Parvathi Sundaram",
        expectedAmount: "200.00",
        amount: "120.00",
        collectedByName: "Selvi M",
      },
    ],
  },
  pendingApprovals: { total: 1, awaitingYou: 1 },
  nearingCompletion: { total: 1, items: [watched(1, 0)] },
  overdue: { total: 2, items: [watched(2, 13), watched(3, 13)] },
};

const trend = {
  businessDate: DATE,
  generatedAt: AT,
  days: 5,
  lineCount: 3,
  points: ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-22", DATE].map(
    (businessDate, index) => ({
      businessDate,
      expected: "48150.00",
      collected: ["47100.00", "48150.00", "45900.00", "48600.00", "46920.00"][
        index
      ]!,
    }),
  ),
};

/**
 * S-07's ledger figures (2026-10-02): the balance sheet on the date and at
 * the month's opening, the month's profit and loss, Books' overview and the
 * overdue summary. The two sides of each sheet are equal, as the API's are.
 */
const sheetOn = (asOf: string, retainedProfit: string, total: string) => ({
  asOf,
  generatedAt: AT,
  assets: {
    officeCash: "120250.00",
    banks: [{ id: "bank-1", name: "SBI Mylapore", balance: "564000.00" }],
    cashWithStaff: [{ id: "staff-1", name: "Ravi K", balance: "151700.00" }],
    loansReceivable: subtract(total, "323650.00"),
    unearnedProfit: "512300.00",
    total,
  },
  equity: {
    capital: "4500000.00",
    drawings: "60000.00",
    retainedProfit,
    total,
  },
  balanced: true,
});

/** `a − b` for two-place decimal strings, in paise, for the fixtures only. */
function subtract(a: string, b: string): string {
  const paise = (value: string) => BigInt(value.replace(".", ""));
  const result = paise(a) - paise(b);
  return `${result / 100n}.${String(result % 100n).padStart(2, "0")}`;
}

const balanceSheet = sheetOn(DATE, "655950.00", "5095950.00");
const openingSheet = sheetOn("2026-08-31", "536180.00", "4976180.00");

const profitAndLoss = {
  from: "2026-09-01",
  to: DATE,
  generatedAt: AT,
  income: {
    earnedProfit: "138420.00",
    otherIncome: "0.00",
    total: "138420.00",
  },
  expenses: {
    categories: [
      { categoryId: "cat-1", name: "Salaries", amount: "12000.00" },
      { categoryId: "cat-2", name: "Fuel", amount: "3150.00" },
      { categoryId: "cat-3", name: "Rent", amount: "2500.00" },
      { categoryId: "cat-4", name: "Stationery", amount: "1000.00" },
    ],
    writeOffLoss: "0.00",
    total: "18650.00",
  },
  netProfit: "119770.00",
};

const booksOverview = {
  asOf: DATE,
  officeCash: "120250.00",
  banks: [
    {
      bankAccountId: "bank-1",
      name: "SBI Mylapore",
      last4: "4821",
      balance: "564000.00",
    },
  ],
  month: {
    from: "2026-09-01",
    expenses: "18650.00",
    otherIncome: "0.00",
    drawings: "0.00",
    capital: "0.00",
    pendingFieldExpenses: 3,
  },
};

const overdueReport = {
  data: [],
  nextCursor: null,
  hasMore: false,
  asOf: DATE,
  generatedAt: AT,
  summary: {
    accounts: 70,
    lines: 9,
    outstanding: "450000.00",
    arrears: "61200.00",
    longestOverdue: null,
  },
};

/**
 * S-19's per-Junior cash (2026-10-02): the discrepancy report's rows for the
 * line and day (BR-17). Selvi's ₹9,600 is acknowledged and tallies; Suresh
 * has counted out ₹5,000 of ₹5,220, waiting for the Senior — ₹220 short.
 */
const cashRow = (
  collectedByUserId: string,
  collectedByName: string,
  collected: string,
  cash: {
    handedOver: string;
    acknowledged: string;
    awaiting: string;
    difference: string;
    state: string;
  },
) => ({
  businessDate: DATE,
  lineId: "line-1",
  lineCode: "LIN-00001",
  lineName: "Mylapore East",
  sectorId: "sec-1",
  sectorName: "Mylapore",
  collectedByUserId,
  collectedByName,
  collected,
  cash: { ...cash, expenses: "0.00", handovers: [] },
  dayCloseStatus: "OPEN",
});

const discrepancy = {
  data: [
    cashRow("user-junior", "Selvi M", "9600.00", {
      handedOver: "9600.00",
      acknowledged: "9600.00",
      awaiting: "0.00",
      difference: "0.00",
      state: "TALLIED",
    }),
    cashRow("user-junior-2", "Suresh P", "5220.00", {
      handedOver: "5000.00",
      acknowledged: "0.00",
      awaiting: "5000.00",
      difference: "-220.00",
      state: "AWAITING",
    }),
  ],
  nextCursor: null,
  hasMore: false,
  from: DATE,
  to: DATE,
  generatedAt: AT,
  summary: {
    rows: 2,
    lines: 1,
    days: 1,
    collected: "14820.00",
    cash: null,
  },
};

const answers: ApiAnswers = {
  "/api/dashboards/overview": { json: overview },
  "/api/reports/discrepancy": { json: discrepancy },
  "/api/books/balance-sheet": (url) => ({
    json: url.searchParams.get("date") === DATE ? balanceSheet : openingSheet,
  }),
  "/api/books/profit-and-loss": { json: profitAndLoss },
  "/api/books/overview": { json: booksOverview },
  "/api/reports/overdue": { json: overdueReport },
  "/api/dashboards/operations": { json: operations },
  "/api/dashboards/line": { json: line },
  "/api/dashboards/trend": { json: trend },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/sectors": { json: { data: [], nextCursor: null, hasMore: false } },
};

/**
 * Each role's landing, and a figure only its dashboard shows — on a
 * computer, and on the phone home (2026-10-02), which shows only what its
 * Stitch screen does.
 */
const DASHBOARDS: [ConsoleRole, string, RegExp, RegExp][] = [
  ["SUPER_ADMIN", "S-07 business overview", /Triplicane/, /Total funds/],
  ["ADMIN", "S-20 operational dashboard", /Luz Corner/, /Luz Corner/],
  ["SENIOR", "S-19 line dashboard", /Parvathi Sundaram/, /Suresh P/],
];

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

test.describe("the dashboards at every width (ADR-0015)", () => {
  for (const [role, screen, figure, phoneFigure] of DASHBOARDS) {
    for (const [name, viewport] of WIDTHS) {
      test(`${screen} fits a ${name}`, async ({ page }) => {
        await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
        await signedInAs(page, role, answers);
        await page.setViewportSize(viewport);
        await page.goto(`/dashboard?date=${DATE}`);

        await expect(
          page
            .getByText(name === "phone" ? phoneFigure : figure)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
        expect(await overflows(page), `${screen} at ${name}`).toBe(false);
      });
    }
  }
});

test.describe("S-07 reads the ledger (2026-10-02)", () => {
  test("the owner sees total funds, where the money is and the month's profit", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SUPER_ADMIN", answers);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);

    const hero = page.getByRole("region", { name: "Fund position" });
    // Capital ₹45 L − drawings ₹0.60 L + kept profit ₹6.56 L.
    await expect(hero.getByText("₹50.96 L").first()).toBeVisible();
    // Against ₹49.76 L at the month's opening: up 2.4%.
    await expect(hero.getByText(/2\.4% this month/)).toBeVisible();
    await expect(hero.getByText("₹1.20 L").first()).toBeVisible();

    const donut = page.getByRole("list", { name: "Fund deployment" });
    // Principal still lent: ₹47,72,300 owed less ₹5,12,300 not yet earned.
    await expect(donut.getByText("₹42.60 L")).toBeVisible();
    await expect(page.getByText("Ledger balances")).toBeVisible();

    await expect(
      // The hero carries it too, for a screen reader; this is the P&L box.
      page.getByText("₹1,19,770.00").last(),
    ).toBeVisible();
    await expect(page.getByText("₹4,50,000.00")).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Pending actions" })
        .getByText("Field expenses to approve"),
    ).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("a balance sheet that fails leaves the day's collections standing", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SUPER_ADMIN", {
      ...answers,
      "/api/books/balance-sheet": { status: 500, json: { code: "INTERNAL" } },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);

    await expect(page.getByText("₹1,76,320.00").first()).toBeVisible();
    await expect(
      page
        .getByText(/Triplicane/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Fund position" })).toHaveCount(
      0,
    );
  });
});

test.describe("S-20 and S-19 redesigned (2026-10-02)", () => {
  test("the Admin sees the day in the hero, what needs someone, and the books", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);

    const hero = page.getByRole("region", { name: "The day" });
    await expect(hero.getByText(/collected$/)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Quick actions" }),
    ).toBeVisible();
    await expect(page.getByText("Ledger today")).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Needs attention" })
        .getByText("Field expenses to approve"),
    ).toBeVisible();
    await expect(page.getByText(/Luz Corner/).first()).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("the Senior sees each Junior's cash, signed, and what waits before closing", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", answers);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);

    const juniors = page.getByRole("table", { name: "Junior staff" });
    // Suresh counted out ₹5,000 of ₹5,220: short, and waiting for the Senior.
    await expect(
      juniors.getByRole("link", {
        name: "Acknowledge ₹5,000.00 from Suresh P",
      }),
    ).toBeVisible();
    await expect(juniors.getByText(/₹220\.00/)).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Pending approvals" })
        .getByText("Handovers to acknowledge"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Close the day/ }),
    ).toBeVisible();
    await expect(page.getByText(/Parvathi Sundaram/).first()).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("the Senior's figures stand when the Juniors' cash can't be read", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", {
      ...answers,
      "/api/reports/discrepancy": { status: 500, json: { code: "INTERNAL" } },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);

    await expect(
      page.getByText(/Juniors’ cash couldn’t be read/),
    ).toBeVisible();
    await expect(page.getByText("Selvi M").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Acknowledge/ })).toHaveCount(
      0,
    );
  });
});

test.describe("the phone home for each console role (2026-10-02)", () => {
  async function onPhone(page: Page, role: ConsoleRole) {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, role, answers);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard?date=${DATE}`);
  }
  const menu = (page: Page) =>
    page.locator("section[aria-labelledby='home-menu']");

  test("the owner's home has the books and the settings in its menu", async ({
    page,
  }) => {
    await onPhone(page, "SUPER_ADMIN");
    await expect(
      page
        .getByRole("region", { name: "Fund position" })
        .getByText("₹50.96 L")
        .first(),
    ).toBeVisible();
    await expect(
      menu(page).getByRole("link", { name: "Balance sheet" }),
    ).toBeVisible();
    await expect(
      menu(page).getByRole("link", { name: "Settings" }),
    ).toBeVisible();
    // Books' 3 field expenses waiting ride on the Expenses tile.
    await expect(
      menu(page).getByRole("link", { name: "Expenses, 3 waiting" }),
    ).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("an Admin's home lists the lines as cards and offers a new customer", async ({
    page,
  }) => {
    await onPhone(page, "ADMIN");
    await expect(page.getByRole("region", { name: "The day" })).toBeVisible();
    await expect(menu(page).getByRole("link", { name: "Ledger" })).toBeVisible();
    await expect(
      menu(page).getByRole("link", { name: "Settings" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("list", { name: "Lines today" }).getByText("Luz Corner"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "New customer" }),
    ).toBeVisible();
    expect(await overflows(page)).toBe(false);
  });

  test("a Senior's home keeps to their line and holds Close the day above the tabs", async ({
    page,
  }) => {
    await onPhone(page, "SENIOR");
    for (const hidden of ["Ledger", "Sectors", "Audit log"]) {
      await expect(menu(page).getByRole("link", { name: hidden })).toHaveCount(
        0,
      );
    }
    await expect(
      menu(page).getByRole("link", { name: "Handovers, 1 waiting" }),
    ).toHaveAttribute("href", `/lines/line-1/day-closes/${DATE}`);
    await expect(
      page
        .getByRole("list", { name: "Pending approvals" })
        .getByRole("link", { name: "Acknowledge ₹5,000.00 from Suresh P" }),
    ).toBeVisible();
    const close = page.getByRole("link", { name: "Close the day" });
    await expect(close).toBeInViewport();
    expect(await overflows(page)).toBe(false);
  });
});

test.describe("the sidebar rail (ADR-0015)", () => {
  // A computer with a mouse. The suite emulates a touch phone, which reports
  // `(hover: none)` — and Tailwind's hover variants rightly do not apply there.
  test.use({ isMobile: false, hasTouch: false });

  const sidebar = (page: Page) => page.locator("#console-sidebar");
  const width = async (page: Page) =>
    Math.round((await sidebar(page).boundingBox())?.width ?? 0);

  /** A computer-width console with the sidebar pinned to its rail. */
  async function onTheRail(page: Page) {
    await withSavedLayout(page, "desktop");
    await page.addInitScript(() => {
      window.localStorage.setItem("rasi.console.sidebar", "rail");
    });
    await signedInAs(page, "ADMIN", answers);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/dashboard?date=${DATE}`);
    await expect(page.getByText(/Luz Corner/).first()).toBeVisible();
    await expect.poll(() => width(page)).toBe(70);
  }

  test("hovering the rail opens it over the page, and leaving closes it", async ({
    page,
  }) => {
    await onTheRail(page);
    const before = await page.getByRole("main").boundingBox();

    await sidebar(page).hover();
    await expect.poll(() => width(page)).toBe(250);
    // Over the page, not beside it: the content does not move.
    expect((await page.getByRole("main").boundingBox())?.x).toBe(before?.x);

    await page.mouse.move(1400, 500);
    await expect.poll(() => width(page)).toBe(70);
  });

  test("tabbing into the rail opens it, so a keyboard user sees the labels", async ({
    page,
  }) => {
    await onTheRail(page);
    await page.mouse.move(1400, 500);

    const firstLink = page
      .getByRole("navigation", { name: "Console" })
      .getByRole("link")
      .first();
    await firstLink.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(firstLink).toBeFocused();
    await expect.poll(() => width(page)).toBe(250);
  });

  test("at tablet width the sidebar is always the rail", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/dashboard?date=${DATE}`);
    await expect(page.getByText(/Luz Corner/).first()).toBeVisible();

    await expect.poll(() => width(page)).toBe(70);
  });
});
