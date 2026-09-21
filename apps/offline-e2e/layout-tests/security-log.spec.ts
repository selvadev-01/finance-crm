import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-31, the refused-attempts log (ADR-0014), in a real browser at the three
 * widths the backlog asks for. **Writes nothing**: no sign-in, so no permanent
 * `LOGIN` row, and the events are fixtures answered inside the browser — which
 * is the only practical way to show a refusal here, since producing a real one
 * means a real refused request and a permanent `security_event`.
 *
 * That the right attempts are recorded is proven at the API, in
 * `apps/api/test/security.e2e-spec.ts`. This proves the screen reads them.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

/**
 * The events themselves. Scoped, because the filter bar's `<option>` list
 * repeats every kind label — an unscoped text match finds the hidden option
 * rather than the row.
 */
const events = (page: Page) => page.getByTestId("security-events");

/**
 * Opens one entry's disclosure, clicking the kind badge rather than the
 * summary itself: at a computer width the summary's centre — where a plain
 * click lands — is the link to the target record, not empty space.
 */
const openEntry = (page: Page, kind: string) =>
  events(page)
    .locator("summary")
    .filter({ hasText: kind })
    .first()
    .getByText(kind)
    .click();

/** An Admin who tried to make themselves a Super Admin — ADR-0014's own example. */
const rankGuard = {
  id: "sec-1",
  createdAt: "2026-09-19T09:15:00.000Z",
  kind: "RANK_GUARD" as const,
  code: "ROLE_ABOVE_OWN",
  status: 403,
  method: "POST",
  path: "/api/staff/:staffProfileId/role",
  actor: {
    userId: "user-admin",
    name: "Lakshmi K",
    role: "ADMIN" as const,
  },
  targetTable: "staff_profile",
  targetId: "staff-owner",
  detail: { attemptedRole: "SUPER_ADMIN" },
  ipAddress: "203.0.113.7",
  userAgent: "Chrome",
};

const outOfScope = {
  ...rankGuard,
  id: "sec-2",
  kind: "OUT_OF_SCOPE" as const,
  code: "CUSTOMER_NOT_FOUND",
  status: 404,
  method: "GET",
  path: "/api/customers/:customerId",
  actor: { userId: "user-senior", name: "Karthik R", role: "SENIOR" as const },
  targetTable: "customer",
  targetId: "cus-9",
  detail: null,
};

const staffList = {
  json: {
    data: [
      {
        staffProfileId: "staff-admin",
        userId: "user-admin",
        name: "Lakshmi K",
        email: "lakshmi@example.com",
        phone: "+919876543210",
        staffCode: "ST-0002",
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: "2026-01-01",
        currentAssignment: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
  },
};

const answers: ApiAnswers = {
  "/api/security-events": {
    json: { data: [rankGuard, outOfScope], nextCursor: null, hasMore: false },
  },
  "/api/staff": staffList,
};

test.describe("the refused-attempts log (S-31)", () => {
  test("names who was refused, what they were answered and on which route", async ({
    page,
  }) => {
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Refused attempts" }),
    ).toBeVisible();

    // Closed, a row says who and what kind — enough to scan a list for the
    // one worth opening.
    await expect(events(page).getByText("Lakshmi K")).toBeVisible();
    await expect(events(page).getByText("Role above their own")).toBeVisible();
    await expect(events(page).getByText("Karthik R")).toBeVisible();
    await expect(events(page).getByText("Not theirs to open")).toBeVisible();
    // The stable code is deliberately behind the disclosure, not on the row.
    await expect(events(page).getByText("ROLE_ABOVE_OWN")).toBeHidden();

    // Opened, it gives the route and the code the caller was answered with —
    // the facts an investigation needs (ADR-0014).
    await openEntry(page, "Role above their own");
    await expect(shown(page, "ROLE_ABOVE_OWN")).toBeVisible();
    await expect(shown(page, "403")).toBeVisible();
    await expect(
      shown(page, "POST /api/staff/:staffProfileId/role"),
    ).toBeVisible();
    // The curated fact, never a request body.
    await expect(shown(page, "SUPER_ADMIN")).toBeVisible();
  });

  test("says nothing was refused rather than showing an empty list", async ({
    page,
  }) => {
    await signedInAs(page, "ADMIN", {
      ...answers,
      "/api/security-events": {
        json: { data: [], nextCursor: null, hasMore: false },
      },
    });
    await page.goto("/settings/security");

    await expect(page.getByText("Nothing refused")).toBeVisible();
  });

  test("offers the filters an investigation starts from", async ({ page }) => {
    // A computer, where the filter bar is open rather than behind its button.
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/settings/security");

    const filters = page.getByRole("form", { name: /Filter/ });
    for (const label of [
      "Reason",
      "Refusal code",
      "Staff member",
      "From",
      "To",
    ]) {
      await expect(filters.getByLabel(label)).toBeVisible();
    }
  });
});

test.describe("at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`the log fits a ${name} without sideways scrolling`, async ({
      page,
    }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers);
      await page.setViewportSize(viewport);
      await page.goto("/settings/security");
      // The filter's staff list arrives after the events and remounts the
      // list, which would close a row opened before it lands.
      await page.waitForLoadState("networkidle");

      // Open one, so the width is judged on the row at its tallest and the
      // long route pattern has to wrap rather than push the page sideways.
      await openEntry(page, "Role above their own");
      await expect(events(page).getByText("ROLE_ABOVE_OWN")).toBeVisible();
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows, `the log scrolls sideways at ${name}`).toBe(false);
    });
  }
});
