import { expect, type Page } from "@playwright/test";

import type { AccountSeed, CustomerSeed, StaffSeed } from "./data";

/**
 * The console and field-app steps the regression journey is made of. Each
 * drives the real screen by its labels, the way a person would, and returns
 * what the next step needs (an id from the URL, a one-time password from a
 * dialog). Nothing here touches the database.
 */

export async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** US-003: the first sign-in with an Admin-issued password forces a new one. */
export async function completeForcedPasswordChange(
  page: Page,
  temporaryPassword: string,
  newPassword: string,
): Promise<void> {
  await page.waitForURL("**/change-password");
  await page.getByLabel("Temporary password").fill(temporaryPassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/change-password"));
}

/** A searchable choice (`Combobox`): open, search, pick. */
export async function choose(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: new RegExp(option) }).click();
}

/** US-092 "Add staff". Returns the temporary password, shown only once. */
export async function addStaff(
  page: Page,
  staff: StaffSeed,
  role: "ADMIN" | "SENIOR" | "JUNIOR",
  joinedOn: string,
): Promise<string> {
  await page.goto("/team");
  await page.getByRole("button", { name: "Add staff" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a staff member" });
  await dialog.getByLabel("Name").fill(staff.name);
  await dialog.getByLabel("Email").fill(staff.email);
  await dialog.getByLabel("Mobile number").fill(staff.phone);
  await dialog.getByLabel("Role").selectOption(role);
  // The hint says blank means today, but the form refuses a blank date
  // (found by this suite, 2026-09-22), so the date is always given.
  await dialog.getByLabel("Joined on").fill(joinedOn);
  await dialog.getByRole("button", { name: "Create staff member" }).click();

  const shown = page.getByRole("dialog", {
    name: `Temporary password for ${staff.name}`,
  });
  const password = (
    await shown.getByLabel("Temporary password").innerText()
  ).trim();
  expect(password.length).toBeGreaterThanOrEqual(10);
  await shown.getByRole("button", { name: "Done" }).click();
  await expect(shown).toBeHidden();
  return password;
}

/** US-010. Only the name is typed — the code is issued. Returns the new id. */
export async function createSector(
  page: Page,
  sector: { name: string },
): Promise<string> {
  await page.goto("/sectors");
  await page.getByRole("button", { name: "New sector" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New sector" });
  await dialog.getByLabel("Name").fill(sector.name);
  await dialog.getByRole("button", { name: "Create sector" }).click();
  await page.waitForURL(/\/sectors\/[^/]+$/);
  return idFrom(page.url());
}

/**
 * US-011. The sector is chosen by its id, which is the option's value, because
 * its label carries the issued code this suite never sees.
 */
export async function createLine(
  page: Page,
  line: { name: string },
  sectorId: string,
): Promise<string> {
  await page.goto("/lines");
  await page.getByRole("button", { name: "New line" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New line" });
  await dialog.getByLabel("Sector").selectOption(sectorId);
  await dialog.getByLabel("Name").fill(line.name);
  await dialog.getByRole("button", { name: "Create line" }).click();
  await page.waitForURL(/\/lines\/[^/]+$/);
  await expect(page.getByRole("heading", { name: line.name })).toBeVisible();
  return idFrom(page.url());
}

/** S-15 (US-012, US-013), from the line's page, effective today. */
export async function assignToLine(
  page: Page,
  lineId: string,
  role: "SENIOR" | "JUNIOR",
  personName: string,
): Promise<void> {
  await page.goto(`/lines/${lineId}`);
  await page
    .getByRole("button", {
      name: role === "SENIOR" ? /^(Assign|Change) Senior$/ : "Add Junior",
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: role === "SENIOR" ? "Senior" : "Junior" })
    .click();
  await page.getByRole("option", { name: new RegExp(personName) }).click();
  await dialog.getByRole("button", { name: /^Use today/ }).click();
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  const saved = page.getByRole("dialog", { name: "Assignment saved" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Done" }).click();
}

/** S-10 (US-020). Returns the new customer's id. */
export async function createCustomer(
  page: Page,
  customer: CustomerSeed,
  lineName: string,
): Promise<string> {
  await page.goto("/customers/new");
  await page.getByLabel("Name", { exact: true }).first().fill(customer.name);
  await page
    .getByLabel("Mobile", { exact: true })
    .first()
    .fill(customer.mobile);
  await page.getByLabel("Address").fill(customer.address);
  await choose(page, "Line", lineName);
  if (customer.notes) {
    await page.getByLabel("Notes (optional)").fill(customer.notes);
  }
  for (const [index, reference] of customer.references.entries()) {
    if (index > 0) {
      await page.getByRole("button", { name: "Add another reference" }).click();
    }
    const card = page
      .locator("li")
      .filter({ hasText: `Reference ${index + 1}` });
    await card.getByLabel("Name", { exact: true }).fill(reference.name);
    await card.getByLabel("Mobile", { exact: true }).fill(reference.mobile);
    await card.getByLabel("Relation (optional)").fill(reference.relation);
  }
  await page.getByRole("button", { name: "Save customer" }).click();

  // A mobile shared with an earlier run's customer is a warning, not a
  // refusal (M04): families share numbers, and so may test runs.
  const saved = page.waitForURL(/\/customers\/(?!new$)[^/]+$/);
  const duplicate = page.getByRole("button", {
    name: "Save anyway",
    exact: true,
  });
  await Promise.race([
    saved,
    duplicate.waitFor().then(() => duplicate.click()),
  ]);
  await saved;
  await expect(
    page.getByRole("heading", { name: customer.name }),
  ).toBeVisible();
  return idFrom(page.url());
}

/** S-04 (US-030, US-030a). Returns the new account's id. */
export async function createAccount(
  page: Page,
  customerId: string,
  account: AccountSeed,
  previousWorkingDay: string,
): Promise<string> {
  await page.goto(`/accounts/new?customerId=${customerId}`);
  await expect(
    page.getByRole("heading", { name: "New account" }),
  ).toBeVisible();
  await page.getByLabel("Account amount (₹)").fill(account.accountAmount);
  await page.getByLabel("Invested amount (₹)").fill(account.investedAmount);
  await page.getByLabel("Daily amount (₹)").fill(account.dailyAmount);
  await page.getByLabel("Term (days)").fill(account.termDays);

  if (account.kind === "mid-term") {
    await page.getByLabel("Disbursement date").fill(previousWorkingDay);
    await page.getByLabel("Collected to date (₹)").fill("0");
  }
  // The preview is the API's own schedule; wait for it before saving.
  await expect(page.getByText("First collection")).toBeVisible();

  const submit =
    account.kind === "mid-term"
      ? "Save mid-term account"
      : account.kind === "pending"
        ? "Save as pending"
        : "Save and disburse";
  await page.getByRole("button", { name: submit }).click();
  await page.waitForURL(/\/accounts\/(?!new)[^/?]+$/);
  return idFrom(page.url());
}

export function idFrom(url: string): string {
  const id = new URL(url).pathname.split("/").pop();
  if (!id) throw new Error(`No id in ${url}`);
  return id;
}
