import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * The console's global search (US-024a) in a real browser: the topbar trigger,
 * the Ctrl-K shortcut, the four groups, and going to a record.
 *
 * Same rule as the rest of this suite — **it writes nothing**: no sign-in, so
 * no permanent `LOGIN` row, and every result below is a fixture answered
 * inside the browser.
 *
 * **This proves the screen, not the rules.** That a Senior finds only their
 * own line's records is scope, proven at the API in
 * `apps/api/test/accounts.e2e-spec.ts` and `staff-directory.e2e-spec.ts` — a
 * result a screen does not render is not access control (M02).
 */

const COMPUTER = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const customer = {
  id: "cust-1",
  customerCode: "CUS-00417",
  name: "Meenakshi Velu",
  mobile: "+919876543210",
  status: "ACTIVE" as const,
  lineId: "line-1",
  lineName: "Mylapore East",
  sectorId: "sector-1",
};

const account = {
  id: "acc-1",
  accountCode: "ACC-2026-00231",
  customerId: "cust-1",
  customerName: "Meenakshi Velu",
  lineId: "line-1",
  lineName: "Mylapore East",
  status: "ACTIVE" as const,
  accountAmount: "10000.00",
  investedAmount: "8500.00",
  profitAmount: "1500.00",
  dailyAmount: "100.00",
  termDays: 100,
  disbursementDate: "2026-06-01",
  firstCollectionDate: "2026-06-02",
  targetCompletionDate: "2026-09-20",
  actualCompletionDate: null,
  collectedAmount: "4000.00",
  outstandingAmount: "6000.00",
  isOverdue: false,
};

const member = {
  staffProfileId: "staff-junior",
  userId: "user-junior",
  name: "Meena R",
  email: "meena@example.com",
  phone: "+919876543210",
  staffCode: "ST-0007",
  role: "JUNIOR" as const,
  status: "ACTIVE" as const,
  joinedAt: "2026-01-01",
  currentAssignment: null,
};

const page$ = <T>(rows: T[]) => ({
  json: { data: rows, nextCursor: null, hasMore: false },
});

/** Answers the three lists, but only for the query the tests type. */
const results: ApiAnswers = {
  "/api/customers": (url) =>
    page$(url.searchParams.get("q") === "meen" ? [customer] : []),
  "/api/accounts": (url) =>
    page$(url.searchParams.get("q") === "meen" ? [account] : []),
  "/api/staff": (url) =>
    page$(url.searchParams.get("q") === "meen" ? [member] : []),
};

/**
 * The console also has a navigation drawer, which is a `<dialog>` too — the
 * palette is taken by its accessible name, never by the tag.
 */
const palette = (page: Page) =>
  page.getByRole("dialog", { name: /Search customers/ });
const field = (page: Page) => palette(page).getByRole("combobox");

test.describe("the global search (US-024a)", () => {
  test("the topbar offers a search box with its shortcut on it", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    const trigger = page.getByRole("button", { name: "Search" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("Ctrl K");
  });

  test("Ctrl-K opens it, Escape closes it, and it opens focused", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await expect(palette(page)).toBeHidden();
    await page.keyboard.press("Control+k");

    await expect(field(page)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
  });

  test("one query finds customers, accounts, team and pages, each in its own group", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await field(page).fill("meen");

    const dialog = palette(page);
    await expect(
      dialog.getByText("Meenakshi Velu", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText("CUS-00417 · Mylapore East")).toBeVisible();
    await expect(dialog.getByText("ACC-2026-00231")).toBeVisible();
    await expect(dialog.getByText("Meena R")).toBeVisible();

    for (const group of ["Customers", "Accounts", "Team"]) {
      await expect(dialog.getByText(group, { exact: true })).toBeVisible();
    }
    // Money stays a formatted string, never a number (non-negotiable 1).
    await expect(dialog.getByText("₹6,000.00")).toBeVisible();
  });

  test("a page is reachable by name, without touching the API", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await field(page).fill("holi");

    const dialog = palette(page);
    await expect(dialog.getByText("Go to", { exact: true })).toBeVisible();
    await dialog.getByText("Holidays", { exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/holidays$/);
  });

  test("choosing a customer goes to that customer", async ({ page }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await field(page).fill("meen");
    await palette(page).getByText("Meenakshi Velu", { exact: true }).click();
    await expect(page).toHaveURL(/\/customers\/cust-1$/);
  });

  test("a query that matches nothing says so, rather than showing an empty list", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await field(page).fill("zzzz");
    await expect(palette(page)).toContainText("Nothing matches");
  });

  test("before anything is typed it says what can be searched", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await expect(palette(page)).toContainText(
      "Search by name, customer code, account code or mobile.",
    );
  });

  test("the phone layout opens the same palette from an icon", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", results);
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Search" }).click();
    await field(page).fill("meen");

    const dialog = palette(page);
    await expect(
      dialog.getByText("Meenakshi Velu", { exact: true }),
    ).toBeVisible();
    // The palette must not spill off a 390px screen.
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});
