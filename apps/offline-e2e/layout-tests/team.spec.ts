import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * The list renders a table and a card list, one hidden by CSS at any width, so
 * a plain text match finds both. This takes the one on screen.
 */
const shown = (page: Page, text: string) =>
  page.getByText(text).filter({ visible: true }).first();

/** A computer-sized window, where the page header shows its actions in full. */
const COMPUTER = { width: 1280, height: 900 };

/**
 * US-092 / S-14 staff administration in a real browser, at the three widths
 * the backlog asks for. Same rule as the rest of this suite — **it writes
 * nothing**: no sign-in, so no permanent `LOGIN` row, and the staff data is
 * fixtures answered inside the browser.
 *
 * **This proves the screen, not the rules.** That an Admin may not delete a
 * Super Admin is access control and is proven at the API in
 * `apps/api/test/rbac-matrix.e2e-spec.ts` — a hidden button is not access
 * control (M02). What is checked here is that the screen does not *offer* what
 * the API would refuse, which is a different and lesser claim.
 */

const WIDTHS = [
  ["phone", { width: 360, height: 780 }],
  ["tablet", { width: 768, height: 1024 }],
  ["computer", { width: 1280, height: 900 }],
] as const;

const assignment = {
  assignmentId: "asg-1",
  lineId: "line-1",
  lineCode: "LN-07",
  lineName: "Mylapore East",
  assignmentRole: "JUNIOR" as const,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
};

const junior = {
  staffProfileId: "staff-junior",
  userId: "user-junior",
  name: "Meena R",
  email: "meena@example.com",
  phone: "+919876543210",
  staffCode: "ST-0007",
  role: "JUNIOR" as const,
  status: "ACTIVE" as const,
  joinedAt: "2026-01-01",
  currentAssignment: assignment,
};

const owner = {
  ...junior,
  staffProfileId: "staff-owner",
  userId: "user-owner",
  name: "Sri Murugan",
  email: "owner@example.com",
  phone: "+919800000000",
  staffCode: "OWNER-01",
  role: "SUPER_ADMIN" as const,
  currentAssignment: null,
};

const detail = (row: typeof junior | typeof owner) => ({
  ...row,
  assignments: row.currentAssignment
    ? [{ ...row.currentAssignment, upcoming: false }]
    : [],
});

const answers: ApiAnswers = {
  "/api/staff": {
    json: { data: [junior, owner], nextCursor: null, hasMore: false },
  },
  "/api/staff/staff-junior": { json: detail(junior) },
  "/api/staff/staff-owner": { json: detail(owner) },
};

test.describe("the team list (S-14)", () => {
  test("shows each person with the line they work today", async ({ page }) => {
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/team");

    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(shown(page, "Meena R")).toBeVisible();
    await expect(shown(page, "ST-0007")).toBeVisible();
    // The line today is the column that makes this list worth reading.
    await expect(shown(page, "Mylapore East")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add staff" }).first(),
    ).toBeVisible();
  });

  test("an empty list says so rather than showing an empty table", async ({
    page,
  }) => {
    await signedInAs(page, "ADMIN", {
      "/api/staff": { json: { data: [], nextCursor: null, hasMore: false } },
    });
    await page.goto("/team");

    await expect(page.getByText("No staff yet")).toBeVisible();
  });

  test("a Senior's list is their own line's team", async ({ page }) => {
    await signedInAs(page, "SENIOR", answers);
    await page.goto("/team");

    await expect(
      page.getByRole("heading", { name: "Your line’s team" }),
    ).toBeVisible();
  });
});

test.describe("one staff member (US-092)", () => {
  test("offers an Admin the actions the API would allow on a Junior", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/team/staff-junior");

    await expect(page.getByRole("heading", { name: "Meena R" })).toBeVisible();
    // Delete is Admin and above (decided 2026-09-20), never on anyone senior.
    for (const label of [
      "Edit details",
      "Reset password",
      "Suspend",
      "Delete",
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
    // Changing a role is Super Admin only, so an Admin is not offered it.
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(
      0,
    );
  });

  test("offers an Admin nothing destructive on the owner, as the API would refuse it", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "ADMIN", answers);
    await page.goto("/team/staff-owner");

    await expect(
      page.getByRole("heading", { name: "Sri Murugan" }),
    ).toBeVisible();
    for (const label of ["Edit details", "Reset password", "Delete"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  });

  test("a Super Admin may act on the owner — themselves aside", async ({
    page,
  }) => {
    await page.setViewportSize(COMPUTER);
    await signedInAs(page, "SUPER_ADMIN", answers);
    await page.goto("/team/staff-junior");

    await expect(
      page.getByRole("button", { name: "Reset password" }),
    ).toBeVisible();
    // The one action only they have.
    await expect(
      page.getByRole("button", { name: "Change role" }),
    ).toBeVisible();
  });
});

test.describe("at every width", () => {
  for (const [name, viewport] of WIDTHS) {
    test(`the team list and a staff page fit a ${name}`, async ({ page }) => {
      await withSavedLayout(page, viewport.width < 768 ? "mobile" : "desktop");
      await signedInAs(page, "ADMIN", answers);
      await page.setViewportSize(viewport);

      for (const path of ["/team", "/team/staff-junior"]) {
        await page.goto(path);
        await expect(shown(page, "Meena R")).toBeVisible();
        const overflows = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflows, `${path} scrolls sideways at ${name}`).toBe(false);
      }
    });
  }
});
