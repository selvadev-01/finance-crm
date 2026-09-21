import { expect, type Page, test } from "@playwright/test";

/**
 * The remaining public screens, in a real browser: US-006 sign-up and the
 * business's own sign-in link, and the US-003 forced password change.
 *
 * Same rule as the rest of this suite — **it writes nothing**. A real sign-up
 * would create an organisation that can never be deleted, and a real sign-in
 * writes a permanent `LOGIN` audit row; every `/api/…` call is answered inside
 * the browser instead. What the fakes cannot prove — that the API creates the
 * business, generates the slug and refuses a duplicate email — is proven over
 * HTTP in `apps/api/test/identity.e2e-spec.ts`.
 */

const SLUG = "sri-murugan-finance";

interface ApiOptions {
  /** How `POST /api/organizations` answers. Defaults to created. */
  signUp?: "created" | { status: number; code: string; message: string };
  /** How `GET /api/organizations/:slug` answers. */
  lookup?: "found" | "missing";
  /** How Better Auth's change-password answers. */
  changePassword?: "ok" | { status: number };
}

async function withApi(page: Page, options: ApiOptions = {}): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/organizations") {
      const answer = options.signUp ?? "created";
      if (answer === "created") {
        // 201, as the contract declares. The client refuses an undeclared
        // status, so 200 here would fail the way a wrong API would.
        await route.fulfill({
          status: 201,
          json: {
            organizationId: "org-browser-test",
            staffProfileId: "staff-browser-test",
            slug: SLUG,
          },
        });
        return;
      }
      await route.fulfill({
        status: answer.status,
        json: {
          code: answer.code,
          message: answer.message,
          details: [{ field: "email", issue: "already has an account" }],
          correlationId: "browser-test",
        },
      });
      return;
    }

    if (path.startsWith("/api/organizations/")) {
      if (options.lookup === "missing") {
        await route.fulfill({
          status: 404,
          json: {
            code: "ORGANIZATION_NOT_FOUND",
            message: "No business uses this link.",
            correlationId: "browser-test",
          },
        });
        return;
      }
      await route.fulfill({
        json: { slug: SLUG, name: "Sri Murugan Finance" },
      });
      return;
    }

    if (path === "/api/auth/change-password") {
      const answer = options.changePassword ?? "ok";
      if (answer === "ok") {
        await route.fulfill({ json: { status: true } });
        return;
      }
      await route.fulfill({
        status: answer.status,
        json: { code: "INVALID_PASSWORD", message: "Wrong password" },
      });
      return;
    }

    if (path.startsWith("/api/auth/sign-in")) {
      await route.fulfill({ json: { status: true } });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "Not found in the layout tests." },
    });
  });
}

/** The sign-up form, filled with values every field accepts. */
async function fillSignUp(
  page: Page,
  overrides: Partial<Record<string, string>> = {},
): Promise<void> {
  const values: Record<string, string> = {
    "Business name": "Sri Murugan Finance",
    "Your name": "Sri Murugan",
    Email: "owner@example.com",
    "Mobile number": "9876543210",
    Password: "correct-horse-1",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
}

test.describe("creating a business (US-006)", () => {
  test("shows the business's sign-in link to share with staff", async ({
    page,
  }) => {
    await withApi(page);
    await page.goto("/sign-up");
    await expect(
      page.getByRole("heading", { name: "Create a business" }),
    ).toBeVisible();

    await fillSignUp(page);
    await page.getByRole("button", { name: "Create business" }).click();

    await expect(page.getByText("Your business is ready.")).toBeVisible();
    // The link is the point of this screen: it must be readable and complete.
    await expect(page.getByLabel("Your business’s sign-in link")).toHaveValue(
      new RegExp(`/${SLUG}/sign-in$`),
    );
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("checks the fields in the browser before asking the API", async ({
    page,
  }) => {
    await withApi(page);
    let asked = false;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/organizations"
      ) {
        asked = true;
      }
    });

    await page.goto("/sign-up");
    await fillSignUp(page, { Email: "not-an-address", Password: "short" });
    await page.getByRole("button", { name: "Create business" }).click();

    await expect(page.getByText(/must be an email address/)).toBeVisible();
    await expect(
      page.getByText(/must be at least 10 characters/),
    ).toBeVisible();
    expect(asked).toBe(false);
  });

  test("puts a refused email on the email field, not in a bare alert", async ({
    page,
  }) => {
    await withApi(page, {
      signUp: {
        status: 409,
        code: "EMAIL_IN_USE",
        message: "That email already has a Rasi account. Use another email.",
      },
    });
    await page.goto("/sign-up");
    await fillSignUp(page);
    await page.getByRole("button", { name: "Create business" }).click();

    await expect(page.getByText(/already has an account/)).toBeVisible();
    await expect(page.getByText("Your business is ready.")).toHaveCount(0);
  });
});

test.describe("a business's own sign-in link (US-006)", () => {
  test("names the business above the ordinary form", async ({ page }) => {
    await withApi(page, { lookup: "found" });
    await page.goto(`/${SLUG}/sign-in`);

    await expect(
      page.getByRole("heading", { name: "Sri Murugan Finance" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Forgotten your password?" }),
    ).toBeVisible();
  });

  test("says so when no business uses the link, and offers the plain page", async ({
    page,
  }) => {
    await withApi(page, { lookup: "missing" });
    await page.goto("/no-such-business/sign-in");

    await expect(
      page.getByText(/No business uses this sign-in link/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "sign in without it" }),
    ).toBeVisible();
  });
});

test.describe("the forced password change (US-003)", () => {
  test("will not submit a confirmation that differs", async ({ page }) => {
    await withApi(page);
    await page.goto("/change-password");

    await page.getByLabel("Temporary password").fill("temp-from-admin");
    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-2");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(
      page.getByText(/does not match the new password/),
    ).toBeVisible();
  });

  test("refuses a new password that repeats the temporary one", async ({
    page,
  }) => {
    await withApi(page);
    await page.goto("/change-password");

    await page.getByLabel("Temporary password").fill("correct-horse-1");
    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-1");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(
      page.getByText(/must be different from the temporary password/),
    ).toBeVisible();
  });

  test("sends a wrong temporary password back to the administrator", async ({
    page,
  }) => {
    await withApi(page, { changePassword: { status: 401 } });
    await page.goto("/change-password");

    await page.getByLabel("Temporary password").fill("wrong-one-here");
    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-1");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(
      page.getByText(/Check it with your administrator/),
    ).toBeVisible();
  });

  test("leaves the screen once the password is changed", async ({ page }) => {
    await withApi(page);
    await page.goto("/change-password");

    await page.getByLabel("Temporary password").fill("temp-from-admin");
    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-1");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(page).not.toHaveURL(/change-password/);
  });
});

test.describe("at both widths", () => {
  for (const [name, viewport] of [
    ["phone", { width: 390, height: 844 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`sign-up fits a ${name} without sideways scrolling`, async ({
      page,
    }) => {
      await withApi(page);
      await page.setViewportSize(viewport);
      await page.goto("/sign-up");

      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});
