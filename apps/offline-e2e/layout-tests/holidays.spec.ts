import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-27 — holidays (US-093) in a real browser. Writes nothing: the list is a
 * fixture, and neither dialog is submitted. Every console role reads the
 * list; declaring and removing are Admin and above, and only for future
 * dates — the API decides `removable`, proven over HTTP.
 */

const COMPUTER = { width: 1280, height: 900 };

const holiday = (overrides: Record<string, unknown> = {}) => ({
  id: "hol-1",
  date: "2026-11-09",
  name: "Deepavali",
  sector: null,
  addedBy: { userId: "user-lakshmi", name: "Lakshmi Krishnan" },
  createdAt: "2026-09-01T05:00:00.000Z",
  removable: true,
  ...overrides,
});

const upcoming = [
  holiday({
    id: "hol-2",
    date: "2026-10-19",
    name: "Ayudha Pooja",
    sector: { id: "sec-1", code: "SEC-00001", name: "Chennai South" },
  }),
  holiday(),
];

const past = [
  holiday({
    id: "hol-0",
    date: "2026-09-14",
    name: "Vinayaka Chathurthi",
    addedBy: null,
    removable: false,
  }),
];

const page$ = (data: unknown[]) => ({
  json: { data, nextCursor: null, hasMore: false },
});

function answers(
  lists: { upcoming: unknown[]; past: unknown[] } = { upcoming, past },
): ApiAnswers {
  return {
    "/api/holidays": (url) =>
      page$(
        url.searchParams.get("period") === "past" ? lists.past : lists.upcoming,
      ),
    "/api/sectors": page$([
      { id: "sec-1", code: "SEC-00001", name: "Chennai South", isActive: true },
      { id: "sec-2", code: "SEC-00002", name: "Chennai North", isActive: true },
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

/** Every request the page sends that is not a read. */
async function captureWrites(page: Page) {
  const sent: string[] = [];
  await page.route("**/api/holidays**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fallback();
    sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ status: 500, json: { code: "X", message: "x" } });
  });
  return sent;
}

test.describe("holidays (S-27)", () => {
  test("an Admin sees upcoming holidays, who added them, and may add or remove", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers());
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays");

    await expect(visible(page, "Deepavali")).toBeVisible({ timeout: 30_000 });
    await expect(visible(page, "09 Nov 2026")).toBeVisible();
    await expect(visible(page, "Monday")).toBeVisible();
    await expect(visible(page, "All sectors")).toBeVisible();
    await expect(visible(page, "Ayudha Pooja")).toBeVisible();
    await expect(visible(page, "Chennai South")).toBeVisible();
    await expect(visible(page, "Lakshmi Krishnan")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add holiday" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove" }).filter({ visible: true }),
    ).toHaveCount(2);
  });

  test("Add holiday opens the form and says what declaring one moves", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers());
    const sent = await captureWrites(page);
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays");

    await page.getByRole("button", { name: "Add holiday" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add holiday" });
    await expect(
      dialog.getByText(
        "Pending collections from that day on move to the next working day",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(dialog.getByLabel("Date")).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(
      dialog.getByLabel("Applies to").locator("option", {
        hasText: "Chennai North (SEC-00002)",
      }),
    ).toHaveCount(1);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([]);
  });

  test("Remove on a future holiday names what becomes a working day again", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers({ upcoming: [holiday()], past }));
    const sent = await captureWrites(page);
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays");

    await page
      .getByRole("button", { name: "Remove" })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Remove Deepavali?" });
    await expect(
      dialog.getByText(
        "09 Nov 2026 becomes a working day again business-wide.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Remove holiday" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([]);
  });

  test("a past holiday offers no Remove", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers());
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays?period=past");

    await expect(visible(page, "Vinayaka Chathurthi")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("a Senior reads the list but may not add or remove", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", answers());
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays");

    await expect(visible(page, "Deepavali")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Add holiday" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("no upcoming holidays says so and, for an Admin, offers the first", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers({ upcoming: [], past: [] }));
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays");

    await expect(visible(page, "No upcoming holidays")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      visible(
        page,
        "Add festival days and closures so nobody is expected to collect on them.",
      ),
    ).toBeVisible();
  });

  test("no past holidays says so", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", answers({ upcoming: [], past: [] }));
    await page.setViewportSize(COMPUTER);
    await page.goto("/settings/holidays?period=past");

    await expect(visible(page, "No past holidays")).toBeVisible({
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
      await signedInAs(page, "ADMIN", answers());
      await page.setViewportSize(viewport);
      await page.goto("/settings/holidays");

      await expect(visible(page, "Ayudha Pooja")).toBeVisible({
        timeout: 30_000,
      });
      expect(await overflows(page), `S-27 at ${name}`).toBe(false);
    });
  }
});
