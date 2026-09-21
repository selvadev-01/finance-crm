import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs } from "./fake-api";

/**
 * US-003 Admin-initiated reset, in a real browser. **Writes nothing**: no
 * sign-in, and the reset itself is a fixture — a real one revokes every
 * session and writes a permanent audit row, which is why the flow has had no
 * browser coverage until now.
 *
 * The API side is proven over HTTP in `apps/api/test/identity.e2e-spec.ts`.
 * What matters here is the one-time password itself: it is shown once, it is
 * selectable and copyable, it is announced, and it stays readable at the width
 * an Admin is most likely to be standing at a counter with.
 */

/** Deliberately in the API's own alphabet: no look-alike characters (M01). */
const TEMPORARY = "7fkqd3xhtvmr";

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
  currentAssignment: null,
};

const answers: ApiAnswers = {
  "/api/staff/staff-junior": { json: { ...junior, assignments: [] } },
  "/api/staff/staff-junior/password-reset": {
    status: 201,
    json: { temporaryPassword: TEMPORARY, sessionsRevoked: 2 },
  },
};

/** Opens the reset dialog on the staff page. */
async function openDialog(page: Page): Promise<void> {
  await signedInAs(page, "ADMIN", answers);
  await page.goto("/team/staff-junior");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Reset password" }).click();
}

test.describe("resetting a staff member's password (US-003)", () => {
  test("names the consequence before doing anything", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDialog(page);

    await expect(
      page.getByRole("heading", { name: "Reset the password for Meena R" }),
    ).toBeVisible();
    // The Admin is told what this costs the person before they confirm.
    await expect(
      page.getByText(/signed out on every device straight away/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset and sign out" }),
    ).toBeVisible();
  });

  test("asks nothing of the API until the Admin confirms", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    let asked = false;
    await signedInAs(page, "ADMIN", answers);
    page.on("request", (request) => {
      if (request.url().includes("password-reset")) asked = true;
    });
    await page.goto("/team/staff-junior");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(
      page.getByRole("button", { name: "Reset and sign out" }),
    ).toBeVisible();

    expect(asked).toBe(false);
  });

  test("shows the temporary password once, selectable and announced", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDialog(page);
    await page.getByRole("button", { name: "Reset and sign out" }).click();

    const shown = page.getByLabel("Temporary password", { exact: true });
    await expect(shown).toHaveText(TEMPORARY);
    // Told to the Admin in words, since it is never shown again (M01).
    await expect(page.getByText(/It is shown only now/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  });

  test("keeps the one-time password legible on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openDialog(page);
    await page.getByRole("button", { name: "Reset and sign out" }).click();

    const shown = page.getByLabel("Temporary password", { exact: true });
    await expect(shown).toHaveText(TEMPORARY);

    // It is read aloud down a phone, so it must not wrap onto two lines and
    // must stay comfortably above the body size. This is the check the type
    // scale finding on this element needs before anything changes it.
    const box = await shown.boundingBox();
    const { lineHeight, fontSize, letterSpacing } = await shown.evaluate(
      (el) => {
        const style = getComputedStyle(el);
        return {
          lineHeight: parseFloat(style.lineHeight),
          fontSize: parseFloat(style.fontSize),
          letterSpacing: parseFloat(style.letterSpacing),
        };
      },
    );
    expect(box, "the password has no box").not.toBeNull();
    // One line: the element is no taller than its line box plus its padding.
    expect(box!.height).toBeLessThan(lineHeight * 2);
    // Larger than body text (14px), which is the point of sizing it at all.
    expect(fontSize).toBeGreaterThan(14);
    // Letters pushed apart, never pulled together: characters are read out
    // one at a time, so a tightened tracking would be actively wrong here.
    expect(letterSpacing).toBeGreaterThan(0);
  });

  test("says so when the reset is refused, and offers no password", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signedInAs(page, "ADMIN", {
      ...answers,
      "/api/staff/staff-junior/password-reset": {
        status: 422,
        json: {
          code: "NO_PASSWORD_CREDENTIAL",
          message: "That account has no password to replace.",
          correlationId: "browser-test",
        },
      },
    });
    await page.goto("/team/staff-junior");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("button", { name: "Reset and sign out" }).click();

    await expect(page.getByText(/no password to replace/)).toBeVisible();
    await expect(
      page.getByLabel("Temporary password", { exact: true }),
    ).toHaveCount(0);
  });
});
