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

const answers: ApiAnswers = {
  "/api/dashboards/overview": { json: overview },
  "/api/dashboards/operations": { json: operations },
  "/api/dashboards/line": { json: line },
  "/api/dashboards/trend": { json: trend },
  "/api/lines": { json: { data: [], nextCursor: null, hasMore: false } },
  "/api/sectors": { json: { data: [], nextCursor: null, hasMore: false } },
};

/** Each role's landing, and a figure that only its dashboard shows. */
const DASHBOARDS: [ConsoleRole, string, RegExp][] = [
  ["SUPER_ADMIN", "S-07 business overview", /Triplicane/],
  ["ADMIN", "S-20 operational dashboard", /Luz Corner/],
  ["SENIOR", "S-19 line dashboard", /Parvathi Sundaram/],
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
  for (const [role, screen, figure] of DASHBOARDS) {
    for (const [name, viewport] of WIDTHS) {
      test(`${screen} fits a ${name}`, async ({ page }) => {
        await withSavedLayout(page, name === "phone" ? "mobile" : "desktop");
        await signedInAs(page, role, answers);
        await page.setViewportSize(viewport);
        await page.goto(`/dashboard?date=${DATE}`);

        await expect(
          page.getByText(figure).filter({ visible: true }).first(),
        ).toBeVisible();
        expect(await overflows(page), `${screen} at ${name}`).toBe(false);
      });
    }
  }
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
