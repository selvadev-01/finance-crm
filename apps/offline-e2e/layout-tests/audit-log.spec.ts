import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-29 — the audit log (US-090), Admin and above, in a real browser. Writes
 * nothing: the entries are fixtures. That a Senior is refused the log is an
 * RBAC cell proven over HTTP; this proves what an Admin is shown.
 */

const COMPUTER = { width: 1280, height: 900 };

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "audit-1",
  createdAt: "2026-09-23T06:15:00.000Z",
  action: "UPDATE",
  entityTable: "customer",
  entityId: "cus-1",
  actor: { userId: "user-lakshmi", name: "Lakshmi Krishnan" },
  system: false,
  before: { address: "14 Kutchery Road, Mylapore" },
  after: { address: "22 Luz Church Road, Mylapore" },
  ipAddress: "203.0.113.24",
  userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/140.0",
  ...overrides,
});

const entries = [
  entry(),
  entry({
    id: "audit-2",
    createdAt: "2026-09-23T13:00:00.000Z",
    action: "REOPEN_DAY",
    entityTable: "day_close",
    entityId: "dc-line-7-2026-09-22",
    before: { status: "CLOSED" },
    after: { status: "REOPENED", reason: "Late collection from Selvi M" },
    ipAddress: null,
    userAgent: null,
  }),
];

const page$ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

function answers(data: unknown[]): ApiAnswers {
  return {
    "/api/audit-log": page$(data),
    "/api/staff": page$([
      {
        staffProfileId: "staff-lakshmi",
        userId: "user-lakshmi",
        name: "Lakshmi Krishnan",
        email: "lakshmi@srimurugan.test",
        phone: "+919840011223",
        staffCode: "STF-00002",
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: "2026-01-05",
        currentAssignments: [],
      },
    ]),
  };
}

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("the audit log (S-29)", () => {
  for (const [who, role] of [
    ["an Admin", "ADMIN"],
    ["the Super Admin", "SUPER_ADMIN"],
  ] as const) {
    test(`lists who did what to which record — ${who}`, async ({ page }) => {
      await withSavedLayout(page, "desktop");
      await signedInAs(page, role, answers(entries));
      await page.setViewportSize(COMPUTER);
      await page.goto("/settings/audit");

      const list = page.getByTestId("audit-entries");
      await expect(list.getByText("Lakshmi Krishnan").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(list.getByRole("link", { name: "cus-1" })).toHaveAttribute(
        "href",
        "/customers/cus-1",
      );
      await expect(list.getByText("Day close")).toBeVisible();
      await expect(list.getByText("dc-line-7-2026-09-22")).toBeVisible();
      // The staff filter is filled from the team.
      await expect(
        page.getByLabel("Staff member").locator("option", {
          hasText: "Lakshmi Krishnan",
        }),
      ).toHaveCount(1);
    });
  }

  test("an entry opens to show where it came from and what changed", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers(entries));
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/audit");

    const list = page.getByTestId("audit-entries");
    const first = list.locator("li").first();
    await expect(first.getByText("203.0.113.24")).toBeHidden({
      timeout: 30_000,
    });
    await first.locator("summary").click();
    await expect(first.getByText("203.0.113.24")).toBeVisible();
    await expect(
      first.getByText("Mozilla/5.0 (Linux; Android 14) Chrome/140.0"),
    ).toBeVisible();
    await expect(first.getByText(/22 Luz Church Road/).first()).toBeVisible();

    const second = list.locator("li").nth(1);
    await second.locator("summary").click();
    await expect(second.getByText("Not recorded").first()).toBeVisible();
  });

  test("an empty log says nothing is recorded yet", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers([]));
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/audit");

    await expect(visible(page, "Nothing recorded yet")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("filters that match nothing say so and offer to clear them", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers([]));
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/audit?action=LOGIN");

    await expect(visible(page, "No entries match")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Clear filters" }).first(),
    ).toBeVisible();
  });

  for (const [name, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["tablet", { width: 768, height: 1024 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`fits a ${name} without sideways scrolling`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers(entries));
      await page.setViewportSize(viewport);
      await page.goto("/settings/audit");

      await expect(
        page.getByTestId("audit-entries").getByText("dc-line-7-2026-09-22"),
      ).toBeVisible({ timeout: 30_000 });
      expect(await overflows(page), `S-29 at ${name}`).toBe(false);
    });
  }
});
