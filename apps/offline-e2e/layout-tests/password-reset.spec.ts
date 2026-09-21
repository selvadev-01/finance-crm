import { expect, type Page, test } from "@playwright/test";

/**
 * US-003 self-service reset, in a real browser.
 *
 * Lives in the layout suite because it shares that suite's one rule: **it
 * writes nothing.** Both screens are public, so there is no sign-in and no
 * `LOGIN` row; Better Auth's two calls are answered inside the browser, which
 * is also the only way to hold a token still — a real one is single-use and
 * lasts 30 minutes.
 *
 * What a fake cannot prove — that an email is queued and a reset audited —
 * is proven against the real tables in
 * `apps/api/test/auth/password-reset.spec.ts` (Tier 1).
 */

const PHONE = { width: 390, height: 844 };
const COMPUTER = { width: 1280, height: 900 };

/** Better Auth's two answers, plus `404` for anything else a page asks for. */
async function withAuthApi(
  page: Page,
  options: { resetStatus?: number } = {},
): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/request-password-reset") {
      await route.fulfill({ json: { status: true } });
      return;
    }
    if (path === "/api/auth/reset-password") {
      const status = options.resetStatus ?? 200;
      await route.fulfill(
        status === 200
          ? { json: { status: true } }
          : { status, json: { code: "INVALID_TOKEN", message: "Invalid" } },
      );
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "Not found in the layout tests." },
    });
  });
}

test.describe("asking for a link", () => {
  test("is reached from sign-in and answers the same either way", async ({
    page,
  }) => {
    await withAuthApi(page);
    await page.goto("/sign-in");

    await page.getByRole("link", { name: "Forgotten your password?" }).click();
    await expect(
      page.getByRole("heading", { name: "Forgotten password" }),
    ).toBeVisible();

    await page.getByLabel("Email").fill("meena@example.com");
    await page.getByRole("button", { name: "Send the link" }).click();

    // The neutral answer: no word about whether that account exists.
    await expect(
      page.getByText(/If that email has a Rasi account/),
    ).toBeVisible();
    await expect(page.getByText(/lasts 30 minutes/)).toBeVisible();
    // The way out for a Junior whose address is an office one.
    await expect(
      page.getByText(/Ask your administrator to reset your password/),
    ).toBeVisible();
  });

  test("checks the address before sending anything", async ({ page }) => {
    await withAuthApi(page);
    let asked = false;
    page.on("request", (request) => {
      if (request.url().includes("request-password-reset")) asked = true;
    });

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("not-an-address");
    await page.getByRole("button", { name: "Send the link" }).click();

    await expect(page.getByText(/must be an email address/)).toBeVisible();
    expect(asked).toBe(false);
  });
});

test.describe("setting the new password", () => {
  test("refuses a link with no token, and offers another", async ({ page }) => {
    await withAuthApi(page);
    await page.goto("/reset-password");

    await expect(
      page.getByRole("heading", { name: "That link no longer works" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Send a new link" }),
    ).toBeVisible();
  });

  test("will not submit two passwords that differ", async ({ page }) => {
    await withAuthApi(page);
    await page.goto("/reset-password?token=layout-test-token");

    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-2");
    await page.getByRole("button", { name: "Set the password" }).click();

    await expect(
      page.getByText(/does not match the new password/),
    ).toBeVisible();
  });

  test("confirms the new password and says every device was signed out", async ({
    page,
  }) => {
    await withAuthApi(page);
    await page.goto("/reset-password?token=layout-test-token");

    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-1");
    await page.getByRole("button", { name: "Set the password" }).click();

    await expect(
      page.getByText(/every device has been signed out/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to sign in" }),
    ).toBeVisible();
  });

  test("says a spent link is spent, rather than that something went wrong", async ({
    page,
  }) => {
    await withAuthApi(page, { resetStatus: 400 });
    await page.goto("/reset-password?token=already-used");

    await page
      .getByLabel("New password", { exact: true })
      .fill("correct-horse-1");
    await page.getByLabel("Confirm new password").fill("correct-horse-1");
    await page.getByRole("button", { name: "Set the password" }).click();

    await expect(
      page.getByText(/has been used already, or it has expired/),
    ).toBeVisible();
  });
});

test.describe("at both widths", () => {
  for (const [name, viewport] of [
    ["phone", PHONE],
    ["computer", COMPUTER],
  ] as const) {
    test(`both screens fit a ${name} without sideways scrolling`, async ({
      page,
    }) => {
      await withAuthApi(page);
      await page.setViewportSize(viewport);

      for (const path of ["/forgot-password", "/reset-password?token=t"]) {
        await page.goto(path);
        const overflows = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflows, `${path} scrolls sideways`).toBe(false);
      }
    });
  }
});
