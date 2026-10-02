import { expect, type Page, test } from "@playwright/test";

import { type Role, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-17 — one collection with its corrections (US-044) in a real browser.
 * Writes nothing: the record is a fixture, and a request for a correction or
 * a reversal is captured and answered here. Who may ask — `canRequestCorrection`
 * and `canReverse` — is the API's to decide and proven over HTTP; this proves
 * the screen offers exactly what it is told, and names the consequence.
 */

const COMPUTER = { width: 1280, height: 900 };

const base = {
  id: "col-1",
  entryType: "ORIGINAL",
  status: "CONFIRMED",
  adjustsCollectionId: null,
  accountLoanId: "acc-1",
  accountCode: "ACC-2026-00412",
  customerId: "cus-1",
  customerName: "Meenakshi Sundaram",
  lineId: "line-7",
  lineName: "Mylapore East",
  collectedByUserId: "user-junior",
  collectedByName: "Selvi M",
  businessDate: "2026-09-22",
  capturedAt: "2026-09-22T05:10:00.000Z",
  syncedAt: "2026-09-22T05:10:04.000Z",
  expectedAmount: "100.00",
  amount: "100.00",
  variance: "0.00",
  classification: "CORRECT",
  note: null,
};

const approval = {
  id: "approval-1",
  decision: "APPROVED",
  reason: "Customer paid ₹80, not ₹100 — typed wrong at the door.",
  requestedByUserId: "user-junior",
  requestedByName: "Selvi M",
  requestedAt: "2026-09-23T06:00:00.000Z",
  decidedByName: "Karthik R",
  decidedAt: "2026-09-23T07:00:00.000Z",
  decisionNote: "Checked with the customer",
  canDecide: false,
};

const adjustment = {
  ...base,
  id: "col-adj-1",
  entryType: "ADJUSTMENT",
  status: "CONFIRMED",
  adjustsCollectionId: "col-1",
  businessDate: "2026-09-23",
  capturedAt: "2026-09-23T06:00:00.000Z",
  syncedAt: "2026-09-23T06:00:00.000Z",
  expectedAmount: "0.00",
  amount: "-20.00",
  classification: "LOW",
  approval,
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...base,
  approval: null,
  adjustments: [adjustment],
  netAmount: "80.00",
  account: { status: "ACTIVE", outstandingAmount: "4320.00" },
  canRequestCorrection: false,
  canReverse: false,
  ...overrides,
});

/** What a request answers: the correction, waiting in the queue. */
const queued = {
  ...approval,
  decision: "PENDING",
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  adjustment: {
    ...base,
    id: "col-adj-2",
    entryType: "ADJUSTMENT",
    status: "PENDING_APPROVAL",
    adjustsCollectionId: "col-1",
    expectedAmount: "0.00",
    amount: "-5.00",
    classification: "LOW",
  },
  original: {
    id: "col-1",
    amount: "100.00",
    businessDate: "2026-09-22",
    classification: "CORRECT",
    netAmount: "80.00",
  },
  correctedAmount: "75.00",
};

/**
 * The collection as `role` reads it, and every POST under it captured —
 * answered here, never sent anywhere.
 */
async function showCollection(
  page: Page,
  role: Role,
  record: Record<string, unknown>,
) {
  const sent: { path: string; body: unknown }[] = [];
  await signedInAs(page, role, {
    [`/api/collections/${String(record.id)}`]: { json: record },
  });
  await page.route("**/api/collections/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fallback();
    sent.push({
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    await route.fulfill({ status: 201, json: queued });
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

test.describe("collection detail (S-17)", () => {
  test("shows the collection, what it stands at, and each correction with who asked and who decided", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showCollection(page, "ADMIN", detail());
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await expect(
      page.getByRole("heading", { name: "Meenakshi Sundaram" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(visible(page, "ACC-2026-00412")).toBeVisible();
    await expect(
      visible(page, /22 Sep 2026 · Mylapore East · collected by Selvi M/),
    ).toBeVisible();
    await expect(visible(page, "₹100.00")).toBeVisible();
    await expect(visible(page, "₹80.00")).toBeVisible();
    await expect(visible(page, "₹4,320.00")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Corrections" }),
    ).toBeVisible();
    await expect(visible(page, "−₹20.00")).toBeVisible();
    await expect(
      visible(page, "Customer paid ₹80, not ₹100 — typed wrong at the door."),
    ).toBeVisible();
    await expect(visible(page, "asked by Selvi M")).toBeVisible();
    await expect(visible(page, "Approved")).toBeVisible();
    await expect(
      visible(page, "by Karthik R — Checked with the customer"),
    ).toBeVisible();
  });

  test("offers nothing the API does not allow", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await showCollection(page, "SENIOR", detail());
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await expect(
      page.getByRole("heading", { name: "Meenakshi Sundaram" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: "Request correction" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0);
  });

  test("a Senior asks for a correction, told what it stands at and that nothing moves yet", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    const sent = await showCollection(
      page,
      "SENIOR",
      detail({ canRequestCorrection: true }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0);
    await page.getByRole("button", { name: "Request correction" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Request a correction of ACC-2026-00412",
    });
    await expect(
      dialog.getByText(
        "It stands at ₹80.00. Enter what was actually collected. Nothing changes until another approver agrees.",
      ),
    ).toBeVisible();
    await expect(dialog.getByLabel("Actually collected (₹)")).toHaveValue(
      "80.00",
    );

    await dialog.getByLabel("Actually collected (₹)").fill("75.00");
    await dialog.getByLabel("Reason").fill("Customer paid ₹75 on the day");
    await dialog.getByRole("button", { name: "Request correction" }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        path: "/api/collections/col-1/corrections",
        body: {
          correctedAmount: "75.00",
          reason: "Customer paid ₹75 on the day",
        },
      },
    ]);
  });

  test("an Admin reverses, told the collection goes to ₹0 once another approver agrees", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    const sent = await showCollection(
      page,
      "ADMIN",
      detail({ canReverse: true }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await expect(
      page.getByRole("button", { name: "Request correction" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Reverse" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Reverse ₹80.00 collected from Meenakshi Sundaram",
    });
    await expect(
      dialog.getByText(
        "The collection goes to ₹0 and the outstanding rises by the same, once another approver agrees.",
        { exact: false },
      ),
    ).toBeVisible();

    await dialog
      .getByLabel("Reason")
      .fill("Recorded against the wrong account");
    await dialog.getByRole("button", { name: "Request reversal" }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        path: "/api/collections/col-1/reversal",
        body: { reason: "Recorded against the wrong account" },
      },
    ]);
  });

  test("a reason is required before anything is sent", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    const sent = await showCollection(
      page,
      "ADMIN",
      detail({ canReverse: true }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await page.getByRole("button", { name: "Reverse" }).click();
    const dialog = page.getByRole("dialog", { name: /^Reverse ₹80.00/ });
    await dialog.getByRole("button", { name: "Request reversal" }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/reason is required/i)).toBeVisible();
    expect(sent).toEqual([]);
  });

  test("a collection never corrected says it stands as recorded", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showCollection(
      page,
      "ADMIN",
      detail({ adjustments: [], netAmount: "100.00" }),
    );
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-1");

    await expect(
      visible(page, "None. The collection stands as recorded."),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a correction opened on its own points back to what it corrects", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await showCollection(page, "ADMIN", {
      ...adjustment,
      adjustments: [],
      netAmount: "-20.00",
      account: { status: "ACTIVE", outstandingAmount: "4320.00" },
      canRequestCorrection: false,
      canReverse: false,
    });
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-adj-1");

    await expect(visible(page, "This is a correction.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: "Open the collection it corrects" }),
    ).toHaveAttribute("href", "/collections/col-1");
    await expect(visible(page, "−₹20.00")).toBeVisible();
  });

  test("a collection outside the caller's scope reads as not found", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR");
    await page.setViewportSize(COMPUTER);
    await page.goto("/collections/col-elsewhere");

    await expect(visible(page, "Collection not found")).toBeVisible({
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
      await showCollection(
        page,
        "ADMIN",
        detail({ canReverse: true, canRequestCorrection: true }),
      );
      await page.setViewportSize(viewport);
      await page.goto("/collections/col-1");

      await expect(visible(page, "asked by Selvi M")).toBeVisible({
        timeout: 30_000,
      });
      expect(await overflows(page), `S-17 at ${name}`).toBe(false);
    });
  }
});
