import { expect, type Page, test } from "@playwright/test";

import { signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-044 — S-18 pending approvals with a correction in it, in a real browser.
 * **Writes nothing**: the queue is a fixture and the decision is captured and
 * answered here. That a decision moves money, and who may make one, is
 * proven over the API (`apps/api/test/collections/correction.service.spec.ts`
 * and the RBAC harness); this proves what the approver is shown and sends.
 */

const COMPUTER = { width: 1280, height: 900 };

const adjustment = {
  id: "col-adj-1",
  entryType: "ADJUSTMENT",
  status: "PENDING_APPROVAL",
  adjustsCollectionId: "col-1",
  accountLoanId: "acc-1",
  accountCode: "ACC-2026-00412",
  customerId: "cus-1",
  customerName: "Meenakshi Sundaram",
  lineId: "line-7",
  lineName: "Mylapore East",
  collectedByUserId: "user-junior",
  collectedByName: "Selvi M",
  businessDate: "2026-09-23",
  capturedAt: "2026-09-23T05:10:00.000Z",
  syncedAt: "2026-09-23T05:10:04.000Z",
  expectedAmount: "0.00",
  amount: "-20.00",
  variance: "0.00",
  classification: "LOW",
  note: null,
};

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "approval-1",
  decision: "PENDING",
  reason: "Customer paid ₹80, not ₹100 — typed wrong at the door.",
  requestedByUserId: "user-junior",
  requestedByName: "Selvi M",
  requestedAt: "2026-09-23T06:00:00.000Z",
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  canDecide: true,
  adjustment,
  original: {
    id: "col-1",
    amount: "100.00",
    businessDate: "2026-09-23",
    classification: "CORRECT",
    netAmount: "100.00",
  },
  correctedAmount: "80.00",
  ...overrides,
});

/**
 * The queue holds one correction until it is decided, then none — as the
 * API's would. Returns what the decision sent.
 */
async function queueWithOne(
  page: Page,
  role: "SENIOR" | "ADMIN",
  overrides: Record<string, unknown> = {},
) {
  let decided = false;
  const sent: Record<string, unknown>[] = [];
  await signedInAs(page, role, {
    "/api/collection-approvals": () => ({
      json: {
        data: decided ? [] : [item(overrides)],
        nextCursor: null,
        hasMore: false,
      },
    }),
  });
  await page.route(
    "**/api/collection-approvals/approval-1/decision",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      decided = true;
      await route.fulfill({
        json: item({ decision: body.decision, canDecide: false }),
      });
    },
  );
  return sent;
}

test.describe("pending approvals with a correction (S-18, US-044)", () => {
  test("shows what was recorded, what it becomes, who asked and why", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await queueWithOne(page, "SENIOR");
    await page.goto("/collections/pending-approval");

    const card = page.getByTestId("approval");
    await expect(card.getByText("Meenakshi Sundaram")).toBeVisible();
    await expect(card.getByText("ACC-2026-00412")).toBeVisible();
    await expect(card.getByText("₹100.00")).toBeVisible();
    await expect(card.getByText("₹80.00")).toBeVisible();
    await expect(
      card.getByText("Customer paid ₹80, not ₹100 — typed wrong at the door."),
    ).toBeVisible();
    await expect(card.getByText("Mylapore East")).toBeVisible();
    await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("approving names the consequence first, then sends the decision and empties the queue", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    const sent = await queueWithOne(page, "SENIOR");
    await page.goto("/collections/pending-approval");

    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Approve ACC-2026-00412: ₹100.00 becomes ₹80.00",
    });
    await expect(
      dialog.getByText(
        "Meenakshi Sundaram's outstanding rises by ₹20.00, and Selvi M's cash in hand falls by the same.",
        { exact: false },
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Approve" }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([{ decision: "APPROVED" }]);
    await expect(page.getByText("Nothing waiting")).toBeVisible();
  });

  test("rejecting says nothing moves, and sends the note with the decision", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    const sent = await queueWithOne(page, "ADMIN");
    await page.goto("/collections/pending-approval");

    await page.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Reject the correction of ACC-2026-00412",
    });
    await expect(
      dialog.getByText("The collection stays at ₹100.00. Nothing moves", {
        exact: false,
      }),
    ).toBeVisible();
    await dialog.getByLabel("Note (optional)").fill("Customer confirmed ₹100");
    await dialog.getByRole("button", { name: "Reject" }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { decision: "REJECTED", note: "Customer confirmed ₹100" },
    ]);
  });

  test("a request the approver cannot decide shows why, with no buttons", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await queueWithOne(page, "ADMIN", { canDecide: false });
    await page.goto("/collections/pending-approval");

    const card = page.getByTestId("approval");
    await expect(
      card.getByText("You requested this — another approver decides it."),
    ).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
  });

  test("the queue fits a phone without sideways scrolling", async ({
    page,
  }) => {
    await withSavedLayout(page, "mobile");
    await queueWithOne(page, "SENIOR");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/collections/pending-approval");

    await expect(page.getByTestId("approval")).toBeVisible();
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
