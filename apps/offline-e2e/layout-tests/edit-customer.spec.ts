import { expect, type Page, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-021 — editing a customer in a real browser. Writes nothing: the record
 * is a fixture and a save is captured and answered here. Who may edit is
 * `customer.update` (Admin and above), proven over HTTP; this proves the form
 * starts from the saved record and that a Senior is not handed the form.
 */

const COMPUTER = { width: 1280, height: 900 };

const customer = {
  id: "cus-1",
  customerCode: "CUS-00412",
  name: "Meenakshi Sundaram",
  mobile: "+919841012345",
  status: "ACTIVE",
  lineId: "line-7",
  lineName: "Mylapore East",
  sectorId: "sec-1",
  alternateMobile: null,
  address: "14 Kutchery Road, Mylapore, Chennai 600004",
  notes: "Runs a flower stall near Kapaleeshwarar temple",
  sectorName: "Chennai South",
  references: [
    {
      id: "ref-1",
      name: "Sundaram Iyer",
      mobile: "+919841098765",
      relation: "husband",
      address: null,
    },
  ],
};

const answers: ApiAnswers = { "/api/customers/cus-1": { json: customer } };

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const visible = (page: Page, text: string | RegExp) =>
  page.getByText(text).filter({ visible: true }).first();

test.describe("edit customer (US-021)", () => {
  for (const [who, role] of [
    ["an Admin", "ADMIN"],
    ["the Super Admin", "SUPER_ADMIN"],
  ] as const) {
    test(`starts from the saved record — ${who}`, async ({ page }) => {
      await withSavedLayout(page, "desktop");
      await signedInAs(page, role, answers);
      await page.setViewportSize(COMPUTER);
      await page.goto("/customers/cus-1/edit");

      await expect(
        page.getByRole("heading", { name: "Edit Meenakshi Sundaram" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(visible(page, "CUS-00412")).toBeVisible();
      await expect(page.getByLabel("Name").first()).toHaveValue(
        "Meenakshi Sundaram",
      );
      await expect(page.getByLabel("Address")).toHaveValue(
        "14 Kutchery Road, Mylapore, Chennai 600004",
      );
      await expect(page.getByLabel("Status")).toHaveValue("ACTIVE");
      await expect(visible(page, "Reference 1")).toBeVisible();
      await expect(page.getByLabel("Relation (optional)")).toHaveValue(
        "husband",
      );
      // The line is moved by a transfer, never edited here.
      await expect(visible(page, "Mylapore East")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save changes" }),
      ).toBeVisible();
    });
  }

  test("saving sends the edited record and returns to the customer", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", answers);
    const sent: Record<string, unknown>[] = [];
    await page.route("**/api/customers/cus-1", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      await route.fulfill({
        json: { ...customer, address: body.address as string },
      });
    });
    await page.setViewportSize(COMPUTER);
    await page.goto("/customers/cus-1/edit");

    await page
      .getByLabel("Address")
      .fill("22 Luz Church Road, Mylapore, Chennai 600004");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/customers\/cus-1$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: "Meenakshi Sundaram",
      address: "22 Luz Church Road, Mylapore, Chennai 600004",
      status: "ACTIVE",
      references: [
        expect.objectContaining({ id: "ref-1", name: "Sundaram Iyer" }),
      ],
    });
  });

  test("a Senior is not handed the form", async ({ page }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "SENIOR", answers);
    await page.setViewportSize(COMPUTER);
    await page.goto("/customers/cus-1/edit");

    await expect(visible(page, "Not available to you")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toHaveCount(0);
  });

  test("a customer outside the caller's access reads as not found", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN");
    await page.setViewportSize(COMPUTER);
    await page.goto("/customers/cus-elsewhere/edit");

    await expect(visible(page, "Customer not found")).toBeVisible({
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
      await signedInAs(page, "ADMIN", answers);
      await page.setViewportSize(viewport);
      await page.goto("/customers/cus-1/edit");

      await expect(
        page.getByRole("heading", { name: "Edit Meenakshi Sundaram" }),
      ).toBeVisible({ timeout: 30_000 });
      expect(await overflows(page), `edit customer at ${name}`).toBe(false);
    });
  }
});
