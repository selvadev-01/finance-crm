import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * S-10's reference person picker (US-020) in a real browser: a reference is
 * very often a customer already on the books, so they are searched by name,
 * customer code or mobile and their details copied into the reference rather
 * than typed a second time.
 *
 * Same rule as the rest of this suite — **it writes nothing**: no sign-in, and
 * the customer search below is a fixture answered inside the browser. Nothing
 * is ever saved here; that the API scopes the search to what this caller may
 * see is proven in `apps/api/test/customers.e2e-spec.ts` (M02).
 */

const PHONE = { width: 390, height: 844 };

const line = {
  id: "line-1",
  sectorId: "sector-1",
  code: "LN-07",
  name: "Mylapore East",
  isActive: true,
};

const neighbour = {
  id: "cust-1",
  customerCode: "CUS-00417",
  name: "Meenakshi Velu",
  mobile: "+919876543210",
  status: "ACTIVE" as const,
  lineId: "line-1",
  lineName: "Mylapore East",
  sectorId: "sector-1",
};

const page$ = <T>(rows: T[]) => ({
  json: { data: rows, nextCursor: null, hasMore: false },
});

/** The line list the form needs, and a customer search that knows one name. */
const answers: ApiAnswers = {
  "/api/lines": page$([line]),
  "/api/customers": (url) =>
    page$(url.searchParams.get("q") === "meen" ? [neighbour] : []),
};

/** The last reference's controls: a second reference is appended below. */
const pickers = (page: Page) =>
  page.getByRole("combobox", { name: "An existing customer (optional)" });
const picker = (page: Page) => pickers(page).last();
const referenceName = (page: Page) =>
  page.getByRole("textbox", { name: "Name" }).last();
const referenceMobile = (page: Page) =>
  page.getByRole("textbox", { name: "Mobile", exact: true }).last();
const searchBox = (page: Page) =>
  page.getByPlaceholder("Name, customer code or mobile");

/**
 * Open the form and wait for it to be live. It is server-rendered before React
 * takes it over, and a click landing in between does nothing; the line list is
 * read in the browser, so its placeholder settling says the page is ready.
 */
async function openForm(page: Page, layout: "mobile" | "desktop") {
  await withSavedLayout(page, layout);
  await signedInAs(page, "ADMIN", answers);
  await page.goto("/customers/new");
  await expect(page.getByRole("combobox", { name: "Line" })).toContainText(
    "Choose a line",
  );
}

/**
 * Open the last reference's picker. The first press on a page the dev server
 * has just rendered can be dropped as the layout settles, so this presses
 * again rather than failing — and never twice while it is open, which would
 * close it.
 */
async function openPicker(page: Page) {
  await expect(async () => {
    if ((await searchBox(page).count()) === 0) await picker(page).click();
    await expect(searchBox(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Add a reference row, for the same reason and in the same way. */
async function addReference(page: Page) {
  await expect(async () => {
    if ((await pickers(page).count()) === 1) {
      await page.getByRole("button", { name: "Add another reference" }).click();
    }
    await expect(pickers(page)).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Search, and choose the one customer the fixture knows. */
async function chooseNeighbour(page: Page) {
  await openPicker(page);
  await searchBox(page).fill("meen");
  await page.getByText("Meenakshi Velu", { exact: true }).click();
  await expect(referenceName(page)).not.toHaveValue("");
}

test.describe("the reference person picker on S-10 (US-020)", () => {
  // A computer, as an Admin onboarding at a desk uses it. Set on the context
  // rather than by resizing: a resized phone context keeps touch emulation,
  // and its clicks land a few pixels off a small button.
  test.use({
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
  });

  test("choosing an existing customer fills their name and mobile", async ({
    page,
  }) => {
    await openForm(page, "desktop");
    await chooseNeighbour(page);

    await expect(referenceName(page)).toHaveValue("Meenakshi Velu");
    // Shown as a mobile is read everywhere else, not as it is stored.
    await expect(referenceMobile(page)).toHaveValue("+91 98765 43210");
    // And it says where the details came from, with a way to check.
    await expect(page.getByText("Copied from")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Meenakshi Velu (CUS-00417)" }),
    ).toHaveAttribute("href", "/customers/cust-1");
  });

  test("the copied details stay editable", async ({ page }) => {
    await openForm(page, "desktop");
    await chooseNeighbour(page);
    await referenceName(page).fill("Meenakshi V (sister)");

    await expect(referenceName(page)).toHaveValue("Meenakshi V (sister)");
  });

  test("a search that matches nothing says so, leaving the fields to be typed", async ({
    page,
  }) => {
    await openForm(page, "desktop");
    await openPicker(page);
    await searchBox(page).fill("zzzz");

    await expect(page.getByText(/No customer matches/)).toBeVisible();
    await expect(referenceName(page)).toHaveValue("");
  });

  test("each reference has its own picker", async ({ page }) => {
    await openForm(page, "desktop");
    await addReference(page);

    // The second reference is filled; the first is left as it was.
    await chooseNeighbour(page);

    await expect(referenceName(page)).toHaveValue("Meenakshi Velu");
    await expect(
      page.getByRole("textbox", { name: "Name" }).nth(1),
    ).toHaveValue("");
  });
});

test.describe("the reference person picker on a phone", () => {
  test("its list stays on a 390px screen", async ({ page }) => {
    await openForm(page, "mobile");
    await openPicker(page);
    await searchBox(page).fill("meen");

    const option = page.getByRole("option", { name: /Meenakshi Velu/ });
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
  });
});
