import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-030b — the collection frequency on S-04 (new account) and on the
 * pending-terms correction dialog, in a real browser. **Writes nothing**:
 * every `/api/…` answer is a fixture, and the requests the screens send are
 * captured and answered here. The schedules themselves are proven in
 * `packages/domain` and `apps/api/test/accounts/collection-frequency.spec.ts`;
 * this proves the screens say the right thing and send what was chosen.
 */

const COMPUTER = { width: 1280, height: 900 };

const customer = {
  id: "cus-ravi",
  customerCode: "CUS-00587",
  name: "Ravi Shankar",
  mobile: "+919842155013",
  status: "ACTIVE",
  lineId: "line-7",
  lineName: "Market Road",
  sectorId: "sec-1",
  sectorName: "Chennai",
  alternateMobile: null,
  address: "3/7 Market Road, Ward 4",
  notes: null,
  references: [],
};

const weeklyPreview = {
  kind: "DAY_ONE",
  profitAmount: "2000.00",
  collectedAmount: "0.00",
  outstandingAmount: "12000.00",
  amountBehind: "0.00",
  firstCollectionDate: "2026-10-01",
  targetCompletionDate: "2026-12-17",
  slotCount: 12,
  slots: Array.from({ length: 12 }, (_, index) => ({
    sequence: index + 1,
    dueDate: `2026-${index < 5 ? "10" : index < 9 ? "11" : "12"}-${String(
      1 + ((index * 7) % 28),
    ).padStart(2, "0")}`,
    expectedAmount: "1000.00",
    status: "PENDING",
  })),
  holidaysSkipped: [],
};

const answers: ApiAnswers = {
  "/api/customers/cus-ravi": { json: customer },
  "/api/accounts": {
    json: { data: [], nextCursor: null, hasMore: false },
  },
  "/api/accounts/preview": { json: weeklyPreview },
};

/** Captures what the form asks the preview for. */
async function capturePreviews(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/accounts/preview", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: weeklyPreview });
  });
  return bodies;
}

test.describe("collection frequency on a new account (S-04, US-030b)", () => {
  test("opens on daily, and choosing weekly renames the fields and the first-visit rule", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/accounts/new?customerId=cus-ravi");

    const picker = page.getByLabel("Collection frequency");
    await expect(picker).toHaveValue("DAILY");
    await expect(page.getByLabel("Daily amount (₹)")).toBeVisible();
    await expect(page.getByLabel("Term (days)")).toBeVisible();

    await picker.selectOption("WEEKLY");
    await expect(page.getByLabel("Weekly amount (₹)")).toBeVisible();
    await expect(page.getByLabel("Term (weeks)")).toBeVisible();
    await expect(page.getByLabel("Daily amount (₹)")).toHaveCount(0);
    await expect(
      page.getByText(
        "Day 0 — collection starts a week later, on the same weekday.",
      ),
    ).toBeVisible();

    await picker.selectOption("MONTHLY");
    await expect(page.getByLabel("Monthly amount (₹)")).toBeVisible();
    await expect(page.getByLabel("Term (months)")).toBeVisible();
  });

  test("a weekly account is previewed as weekly, and the preview explains how its visits move", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    const previews = await capturePreviews(page);
    await page.goto("/accounts/new?customerId=cus-ravi");

    await page.getByLabel("Account amount (₹)").fill("12000");
    await page.getByLabel("Invested amount (₹)").fill("10000");
    await page.getByLabel("Collection frequency").selectOption("WEEKLY");
    await page.getByLabel("Weekly amount (₹)").fill("1000");
    await page.getByLabel("Term (weeks)").fill("12");

    await expect(
      page.getByText(
        "A visit falling on a Sunday or a holiday moves to the next working day; the visits after it keep their dates.",
      ),
    ).toBeVisible();
    expect(previews.at(-1)).toMatchObject({
      collectionFrequency: "WEEKLY",
      dailyAmount: "1000",
      termDays: 12,
    });
  });

  test("the form fits a phone without sideways scrolling", async ({ page }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", answers);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/accounts/new?customerId=cus-ravi");

    await page.getByLabel("Collection frequency").selectOption("MONTHLY");
    await expect(page.getByLabel("Monthly amount (₹)")).toBeVisible();
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe("correcting a pending account's terms (S-11, US-030b)", () => {
  const pending = {
    id: "acc-weekly",
    accountCode: "ACC-2026-00931",
    customerId: "cus-ravi",
    customerName: "Ravi Shankar",
    lineId: "line-7",
    lineName: "Market Road",
    status: "PENDING",
    accountAmount: "12000.00",
    investedAmount: "10000.00",
    profitAmount: "2000.00",
    dailyAmount: "1000.00",
    termDays: 12,
    collectionFrequency: "WEEKLY",
    disbursementDate: "2099-01-05",
    firstCollectionDate: "2099-01-12",
    targetCompletionDate: "2099-03-30",
    actualCompletionDate: null,
    collectedAmount: "0.00",
    outstandingAmount: "12000.00",
    isOverdue: false,
  };

  test("a weekly account stays weekly: the dialog opens on it, worded in weeks, and sends it back", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", {
      "/api/accounts/acc-weekly": { json: pending },
      "/api/accounts/acc-weekly/schedule": { json: { slots: [] } },
    });
    let sent: Record<string, unknown> | undefined;
    await page.route("**/api/accounts/acc-weekly", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ...pending, termDays: 13 } });
    });

    await page.goto("/accounts/acc-weekly");
    await page.getByRole("button", { name: "Correct terms" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct ACC-2026-00931" });

    await expect(dialog.getByLabel("Collection frequency")).toHaveValue(
      "WEEKLY",
    );
    await expect(dialog.getByLabel("Weekly amount (₹)")).toHaveValue("1000.00");
    await expect(dialog.getByLabel("Term (weeks)")).toHaveValue("12");

    await dialog.getByLabel("Term (weeks)").fill("13");
    await dialog.getByRole("button", { name: "Save terms" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toMatchObject({
      collectionFrequency: "WEEKLY",
      termDays: 13,
    });
  });
});
