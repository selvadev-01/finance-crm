import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { getPrismaClient } from "@repo/db";
import { parseCalendarDate, toUtcMidnight } from "@repo/domain";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chennaiDataset, type LineKey, type SectorKey } from "./data";
import {
  addStaff,
  assignToLine,
  completeForcedPasswordChange,
  createAccount,
  createCustomer,
  createLine,
  createSector,
  signIn,
} from "./helpers";
import {
  OWNER_PASSWORD,
  REGRESSION_FIXTURE_PATH,
  type RegressionFixture,
  STAFF_PASSWORD,
} from "./setup";

/**
 * The full business day, Admin → Senior → Junior, through the real screens,
 * API and database. **Every row written here is permanent** — see
 * playwright.regression.config.ts.
 *
 * Prisma is used only to read (account codes, and the books at the end) and
 * for the one recorded shortcut in the Admin step: moving the first slot of
 * the accounts disbursed today to today (BR-03 makes it tomorrow), so the
 * Junior's route has work on it — the same shortcut the offline suite takes.
 */
process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
const fixture = JSON.parse(
  readFileSync(REGRESSION_FIXTURE_PATH, "utf8"),
) as RegressionFixture;
const data = chennaiDataset(fixture.runId);
const prisma = getPrismaClient();
const today = parseCalendarDate(fixture.businessDate);

test.skip(fixture.skip !== null, fixture.skip ?? "");

/** Filled in as the journey goes; each step reads what an earlier one made. */
const made = {
  adminTemporaryPassword: "",
  seniorTemporaryPassword: "",
  juniorTemporaryPassword: "",
  sectors: {} as Record<SectorKey, string>,
  lines: {} as Record<LineKey, string>,
  customers: {} as Record<string, string>,
  accounts: {} as Record<string, { id: string; code: string }>,
};
const code = (account: string) => made.accounts[account]!.code;

const money = (value: { toFixed: (places: number) => string }) =>
  value.toFixed(2);

test.describe.serial("regression: a business day in Chennai", () => {
  let owner: BrowserContext;
  let admin: BrowserContext;
  let senior: BrowserContext;
  let junior: BrowserContext;
  let ownerPage: Page;
  let adminPage: Page;
  let seniorPage: Page;
  let juniorPage: Page;

  test.beforeAll(async ({ browser }) => {
    const desk = {
      baseURL: "http://localhost:3000",
      viewport: { width: 1280, height: 860 },
    };
    owner = await browser.newContext(desk);
    admin = await browser.newContext(desk);
    senior = await browser.newContext(desk);
    // 360px: the field app's design target (design-system.md).
    junior = await browser.newContext({
      baseURL: "http://localhost:3000",
      serviceWorkers: "allow",
      viewport: { width: 360, height: 780 },
    });
    ownerPage = await owner.newPage();
    adminPage = await admin.newPage();
    seniorPage = await senior.newPage();
    juniorPage = await junior.newPage();
  });

  test.afterAll(async () => {
    await Promise.all([
      owner?.close(),
      admin?.close(),
      senior?.close(),
      junior?.close(),
    ]);
    await prisma.$disconnect();
  });

  test("Super Admin opens the business and appoints the Admin", async () => {
    const page = ownerPage;
    await signIn(page, data.owner.email, OWNER_PASSWORD);
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

    // US-092: nobody creates a role above their own, so the Admin comes from
    // the owner and the Senior and Junior from the Admin.
    made.adminTemporaryPassword = await addStaff(
      page,
      data.admin,
      "ADMIN",
      today,
    );
    await page.goto("/team");
    await expect(page.getByText(data.admin.name).first()).toBeVisible();
  });

  test("Admin builds the business: staff, sectors, lines, customers, accounts", async () => {
    test.setTimeout(8 * 60_000);
    const page = adminPage;
    await signIn(page, data.admin.email, made.adminTemporaryPassword);
    await completeForcedPasswordChange(
      page,
      made.adminTemporaryPassword,
      STAFF_PASSWORD,
    );

    // US-092: the Admin creates the Senior and the Junior.
    made.seniorTemporaryPassword = await addStaff(
      page,
      data.senior,
      "SENIOR",
      today,
    );
    made.juniorTemporaryPassword = await addStaff(
      page,
      data.junior,
      "JUNIOR",
      today,
    );
    await page.goto("/team");
    await expect(page.getByText(data.senior.name).first()).toBeVisible();
    await expect(page.getByText(data.junior.name).first()).toBeVisible();

    // US-010, US-011: Chennai's zones and their areas.
    for (const key of Object.keys(data.sectors) as SectorKey[]) {
      made.sectors[key] = await createSector(page, data.sectors[key]);
    }
    for (const key of Object.keys(data.lines) as LineKey[]) {
      const line = data.lines[key];
      made.lines[key] = await createLine(page, line, made.sectors[line.sector]);
    }

    // US-012, US-013: Murugan and Selvi work Royapuram from today.
    await assignToLine(page, made.lines.royapuram, "SENIOR", data.senior.name);
    await assignToLine(page, made.lines.royapuram, "JUNIOR", data.junior.name);
    await page.goto(`/lines/${made.lines.royapuram}`);
    await expect(page.getByText(data.senior.name).first()).toBeVisible();

    // US-020, US-030, US-030a: customers and their accounts.
    for (const customer of data.customers) {
      const customerId = await createCustomer(
        page,
        customer,
        data.lines[customer.line].name,
      );
      made.customers[customer.key] = customerId;
      for (const account of customer.accounts) {
        const id = await createAccount(
          page,
          customerId,
          account,
          fixture.previousWorkingDay,
        );
        const row = await prisma.accountLoan.findUniqueOrThrow({
          where: { id },
          select: { accountCode: true, status: true },
        });
        expect(row.status, account.key).toBe(
          account.kind === "pending" ? "PENDING" : "ACTIVE",
        );
        made.accounts[account.key] = { id, code: row.accountCode };
        await expect(page.getByText(row.accountCode).first()).toBeVisible();
      }
    }

    // The recorded shortcut (see the file comment): today's route has work.
    for (const customer of data.customers.filter(
      (each) => each.line === "royapuram",
    )) {
      for (const account of customer.accounts.filter(
        (each) => each.kind === "disburse",
      )) {
        await prisma.accountSchedule.updateMany({
          where: { accountLoanId: made.accounts[account.key]!.id, sequence: 1 },
          data: { dueDate: toUtcMidnight(today) },
        });
      }
    }
  });

  test("Senior signs in, sees only Royapuram, and sets the visiting order", async () => {
    const page = seniorPage;
    await signIn(page, data.senior.email, made.seniorTemporaryPassword);
    await completeForcedPasswordChange(
      page,
      made.seniorTemporaryPassword,
      STAFF_PASSWORD,
    );

    // M02: another line's customer is out of scope — absent from the list,
    // and a 404 (never a 403) when asked for directly.
    await page.goto("/customers");
    await expect(page.getByText("Anbu Selvan").first()).toBeVisible();
    await expect(page.getByText("Ganesh Babu")).toHaveCount(0);
    const outOfScope = await page.request.get(
      `/api/customers/${made.customers["ganesh"]}`,
    );
    expect(outOfScope.status()).toBe(404);

    // US-016: Kavitha moves up one place, and the order is saved.
    await page.goto(`/lines/${made.lines.royapuram}`);
    const order = page.getByTestId("visiting-order");
    await expect(order).toBeVisible();
    await page.getByRole("button", { name: "Move Kavitha Rajan up" }).click();
    await page.getByRole("button", { name: "Save order" }).click();
    // Nothing left to save once everyone is placed: the button goes away.
    await expect(
      page.getByText("Visiting order saved", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save order" })).toHaveCount(
      0,
    );
    const placed = await order.getByRole("listitem").allInnerTexts();
    expect(placed.findIndex((text) => text.includes("Kavitha Rajan"))).toBe(2);
  });

  test("Junior signs in and collects along the Royapuram route", async () => {
    test.setTimeout(5 * 60_000);
    const page = juniorPage;
    await signIn(page, data.junior.email, made.juniorTemporaryPassword);
    await completeForcedPasswordChange(
      page,
      made.juniorTemporaryPassword,
      STAFF_PASSWORD,
    );
    await page.waitForURL("**/route");
    await expect(page.getByTestId("route")).toBeVisible();

    // Every Royapuram account due today is on the route; nothing else is.
    for (const visit of data.visits) {
      await expect(
        page.getByTestId(`account-${code(visit.account)}`),
      ).toBeVisible();
    }
    await expect(page.getByTestId(`account-${code("ganesh-1")}`)).toHaveCount(
      0,
    );
    await expect(page.getByTestId(`account-${code("priya-1")}`)).toHaveCount(0);
    // US-030a: a mid-term account's "collected to date" covers today, so its
    // first remaining slot is tomorrow and it is not on today's route.
    for (const account of data.notDueToday) {
      await expect(page.getByTestId(`account-${code(account)}`)).toHaveCount(0);
    }

    // In the order the Senior saved, for the customers due today.
    const names = data.customers
      .filter((customer) => customer.line === "royapuram")
      .map((customer) => customer.name);
    const inOrder = (texts: string[]) =>
      texts
        .map((text) => names.find((name) => text.includes(name)))
        .filter((name): name is string => name !== undefined);
    const routeOrder = inOrder(
      await page.getByTestId(/^customer-/).allInnerTexts(),
    );
    const seniorOrder = inOrder(
      await seniorPage
        .getByTestId("visiting-order")
        .getByRole("listitem")
        .allInnerTexts(),
    ).filter((name) => routeOrder.includes(name));
    expect(routeOrder).toEqual(seniorOrder);

    for (const visit of data.visits) {
      if (visit.amount === null) continue;
      const accountCode = code(visit.account);
      await page.getByTestId(`account-${accountCode}`).click();
      const form = page.getByTestId(`collect-${accountCode}`);
      await expect(form).toBeVisible();
      if (visit.amount === "NO_PAYMENT") {
        await form.getByRole("button", { name: /^No payment/ }).click();
        await page.getByRole("button", { name: "Record no payment" }).click();
      } else {
        await form.getByLabel("Amount collected (₹)").fill(visit.amount);
        await form.getByRole("button", { name: /^Confirm/ }).click();
      }
      await backToRoute(page);
    }

    // US-052: online, every entry reaches the office by itself.
    for (const visit of data.visits.filter((each) => each.amount !== null)) {
      await expect(
        page.getByTestId(`account-${code(visit.account)}`),
      ).toHaveAttribute("data-state", "SYNCED", { timeout: 60_000 });
    }

    // US-044: Selvi asks to correct Meenakshi's ₹30 to the ₹40 she was paid.
    await page.goto("/route#correct");
    await expect(page.getByTestId("correct")).toBeVisible();
    await page
      .getByRole("button")
      .filter({ hasText: data.correction.customerName })
      .click();
    await page
      .getByLabel("What you actually collected (₹)")
      .fill(data.correction.correctedAmount);
    await page.getByLabel("Why").fill(data.correction.reason);
    await page.getByRole("button", { name: "Ask to correct" }).click();
    await expect(page.getByText(/^Sent to your Senior/)).toBeVisible();
  });

  test("Senior approves the correction", async () => {
    const page = seniorPage;
    await page.goto("/collections/pending-approval");
    const card = page
      .getByTestId("approval")
      .filter({ hasText: code(data.correction.account) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toHaveCount(0);
  });

  test("Junior counts the cash and hands it to the Senior", async () => {
    const page = juniorPage;
    await page.goto("/route#handover");
    const day = page.getByTestId(`cash-${today}`);
    await expect(day).toBeVisible();
    for (const [denomination, count] of data.handoverCounts) {
      await day
        .getByLabel(
          `Number of ₹${denomination} ${denomination >= 10 ? "notes" : "coins"}`,
        )
        .fill(String(count));
    }
    // ₹390 counted against ₹390 recorded, correction included.
    await expect(day.getByText("Matches")).toBeVisible();
    await day
      .getByRole("button", {
        name: new RegExp(`^Hand .* to ${data.senior.name}`),
      })
      .click();
    await expect(
      day.getByText(`waiting for ${data.senior.name} to acknowledge`),
    ).toBeVisible();
  });

  test("Senior acknowledges the cash and closes the day", async () => {
    const page = seniorPage;
    await page.goto("/cash");
    await page.getByRole("button", { name: "Acknowledge" }).first().click();
    await page.getByRole("button", { name: "I have the cash" }).click();
    await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(
      0,
    );

    await page.goto(`/lines/${made.lines.royapuram}/day-closes/${today}`);
    await page.getByRole("button", { name: "Close day" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Close day" }).click();
    // A phone that has not reported in yet is a warning, not a refusal.
    const anyway = dialog.getByRole("button", { name: "Close anyway" });
    await Promise.race([
      dialog.waitFor({ state: "hidden" }),
      anyway.waitFor().then(() => anyway.click()),
    ]);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Close day" })).toHaveCount(
      0,
    );
  });

  test("Admin finds the day in the books", async () => {
    const page = adminPage;

    // The corrected account shows its new balance on its own page.
    await page.goto(`/accounts/${made.accounts[data.correction.account]!.id}`);
    await expect(page.getByText(/4,960/).first()).toBeVisible();

    // Every balance, from the database: only this run's accounts.
    for (const [key, outstanding] of Object.entries(
      data.expected.outstanding,
    )) {
      const account = await prisma.accountLoan.findUniqueOrThrow({
        where: { id: made.accounts[key]!.id },
      });
      expect(money(account.outstandingAmount), key).toBe(outstanding);
    }

    // BR-08, US-044: one row per visit; the correction is an ADJUSTMENT row,
    // never an edit of the original.
    for (const visit of data.visits) {
      const rows = await prisma.collection.findMany({
        where: { accountLoanId: made.accounts[visit.account]!.id },
        select: { entryType: true, status: true },
      });
      const expected =
        visit.amount === null
          ? []
          : visit.account === data.correction.account
            ? ["ADJUSTMENT", "ORIGINAL"]
            : ["ORIGINAL"];
      expect(rows.map((row) => row.entryType).sort(), visit.account).toEqual(
        expected,
      );
      expect(rows.every((row) => row.status === "CONFIRMED")).toBe(true);
    }

    // BR-16: the unvisited slot is MISSED, and the day tallies.
    const missed = await prisma.accountSchedule.findFirstOrThrow({
      where: {
        accountLoanId: made.accounts["devi-1"]!.id,
        dueDate: toUtcMidnight(today),
      },
    });
    expect(missed.status).toBe("MISSED");
    const dayClose = await prisma.dayClose.findFirstOrThrow({
      where: {
        lineId: made.lines.royapuram,
        businessDate: toUtcMidnight(today),
      },
    });
    expect(money(dayClose.expectedTotal)).toBe(data.expected.expectedTotal);
    expect(money(dayClose.collectedTotal)).toBe(data.expected.collectedTotal);
    expect(money(dayClose.cashReceivedTotal)).toBe(
      data.expected.collectedTotal,
    );
    expect(dayClose.status).toBe("TALLIED");

    const handover = await prisma.cashHandover.findFirstOrThrow({
      where: { dayCloseId: dayClose.id },
    });
    expect(handover.status).toBe("ACKNOWLEDGED");
    expect(money(handover.discrepancy)).toBe("0.00");

    // M13: each kind of write the journey made is in the audit log.
    const audited = await prisma.auditLog.findMany({
      where: { organizationId: fixture.organizationId },
      select: { entityTable: true },
    });
    const tables = new Set(audited.map((row) => row.entityTable));
    for (const table of [
      "staff_profile",
      "sector",
      "line",
      "line_assignment",
      "customer",
      "account_loan",
      "collection",
      "cash_handover",
      "day_close",
    ]) {
      expect(tables.has(table), table).toBe(true);
    }
  });
});

/** Back to S-01 from wherever recording left the Junior. */
async function backToRoute(page: Page): Promise<void> {
  const route = page.getByTestId("route");
  // One account returns to the route by itself; a customer with two stays.
  const returned = await route
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!returned) {
    await page.getByRole("button", { name: "Route" }).click();
  }
  await expect(route).toBeVisible();
}
