import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import { getPrismaClient } from "@repo/db";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Fixture, FIXTURE_PATH, PASSWORD } from "../global-setup";

/**
 * E06 against a real browser, service worker, IndexedDB and API
 * (offline-sync.md#testing). Rows written here are permanent.
 */
process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const prisma = getPrismaClient();

test.skip(fixture.skip !== null, fixture.skip ?? "");
test.afterAll(async () => {
  await prisma.$disconnect();
});

const account = (index: number) => fixture.accounts[index]!;
const collectionsFor = (accountLoanId: string) =>
  prisma.collection.count({ where: { accountLoanId } });

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(fixture.junior.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/route");
  await expect(page.getByTestId("route")).toBeVisible();
}

/**
 * Registration happens on the first visit; a reload puts the page under the
 * worker. Polls the registration rather than `serviceWorker.ready`, which never
 * resolves for a page reached by client-side navigation from /sign-in.
 */
async function underServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/route");
          return registration?.active?.state ?? null;
        }),
      { timeout: 60_000 },
    )
    .toBe("activated");
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect(page.getByTestId("route")).toBeVisible();
}

/**
 * Signal returns. Playwright's offline emulation does not toggle
 * `navigator.onLine` for a page under a service worker, so the `online` event a
 * phone fires on reconnecting is dispatched here.
 */
async function signalReturns(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

function row(page: Page, index: number) {
  return page.getByTestId(`account-${account(index).code}`);
}

/** S-01 → S-02 → confirm the pre-filled expected amount: the one-tap case. */
async function recordExpected(page: Page, index: number, tap: "single" | "double" = "single"): Promise<void> {
  await row(page, index).click();
  const confirm = page.getByTestId(`collect-${account(index).code}`).getByRole("button", { name: /^Confirm/ });
  await (tap === "double" ? confirm.dblclick() : confirm.click());
  // One account: back on the route with the row marked.
  await expect(page.getByTestId("route")).toBeVisible();
}

/** S-01's row state for the account: PENDING, SAVED, SYNCING or SYNCED. */
const stateOf = (page: Page, index: number) => row(page, index);

/** S-03, opened from the status bar. */
async function openSync(page: Page): Promise<void> {
  await page.getByTestId("status-bar").getByRole("button").click();
  await expect(page.getByTestId("sync")).toBeVisible();
}

async function backToRoute(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Route" }).click();
  await expect(page.getByTestId("route")).toBeVisible();
}

const entryFor = (page: Page, index: number) =>
  page.getByTestId("outbox-entry").filter({ hasText: account(index).code });

test.describe.serial("offline field app (E06)", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // 360px: the field app's design target (design-system.md).
    context = await browser.newContext({
      baseURL: "http://localhost:3000",
      serviceWorkers: "allow",
      viewport: { width: 360, height: 780 },
    });
    page = await context.newPage();
    await signIn(page);
    await underServiceWorker(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("US-051 / US-050 / US-052: the route opens with no signal, a collection saves on the phone, and is sent exactly once when signal returns", async () => {
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("route")).toBeVisible();
    await expect(page.getByTestId("connection")).toHaveText("Offline");

    await page.screenshot({ path: "test-results/screens/s01-route-offline.png", fullPage: true });
    await row(page, 0).click();
    await expect(page.getByTestId(`collect-${account(0).code}`)).toBeVisible();
    await page.screenshot({ path: "test-results/screens/s02-record.png", fullPage: true });
    await backToRoute(page);

    await recordExpected(page, 0);
    await expect(stateOf(page, 0)).toHaveAttribute("data-state", "SAVED");
    await page.screenshot({ path: "test-results/screens/s01-saved-on-phone.png", fullPage: true });
    await expect(row(page, 0)).toContainText("Saved on phone");
    await expect(page.getByText(/^Saved on phone: ₹/)).toBeVisible();
    await expect(page.getByTestId("unsynced-count")).toHaveText("1");
    await expect(row(page, 0).getByTestId("collected-today")).toBeVisible();
    expect(await collectionsFor(account(0).id)).toBe(0);

    await openSync(page);
    await expect(entryFor(page, 0)).toHaveAttribute("data-status", "QUEUED");
    await page.screenshot({ path: "test-results/screens/s03-not-sent.png", fullPage: true });
    await backToRoute(page);

    await signalReturns(context, page);
    // Well inside the one-minute periodic drain: reconnecting sends at once.
    await expect(stateOf(page, 0)).toHaveAttribute("data-state", "SYNCED", { timeout: 20_000 });
    await expect(row(page, 0)).toContainText("Sent to office");
    await expect(page.getByTestId("unsynced-count")).toHaveText("0");
    expect(await collectionsFor(account(0).id)).toBe(1);

    await openSync(page);
    await expect(page.getByTestId("all-synced")).toContainText("Last sent");
    await page.screenshot({ path: "test-results/screens/s03-all-sent.png", fullPage: true });
    await backToRoute(page);
  });

  test("US-053: the server commits but the response is lost — the retry carries the same key and creates nothing new", async () => {
    let dropped = false;
    await context.route("**/api/collections", async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch(); // the server processes it…
      await route.abort("failed"); // …and the phone never hears back
    });

    await recordExpected(page, 1);
    await expect.poll(() => collectionsFor(account(1).id)).toBe(1);
    await expect(stateOf(page, 1)).toHaveAttribute("data-state", "SAVED");

    await context.unroute("**/api/collections");
    await page.waitForTimeout(2_500); // past the first backoff
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(stateOf(page, 1)).toHaveAttribute("data-state", "SYNCED", { timeout: 60_000 });

    expect(await collectionsFor(account(1).id)).toBe(1);
    const stored = await prisma.accountLoan.findUniqueOrThrow({ where: { id: account(1).id } });
    expect(stored.outstandingAmount.toFixed(2)).toBe("900.00");
  });

  test("a 401 mid-sync keeps every collection and sends them after signing in again", async () => {
    await context.setOffline(true);
    // A double tap at the door records one collection, not two.
    await recordExpected(page, 2, "double");
    await expect(stateOf(page, 2)).toHaveAttribute("data-state", "SAVED");

    // The session ends while the phone is offline.
    await prisma.session.deleteMany({ where: { userId: fixture.junior.userId } });
    await signalReturns(context, page);
    await expect(page.getByText("Your sign-in has expired.")).toBeVisible({ timeout: 60_000 });
    await openSync(page);
    await expect(entryFor(page, 2)).toHaveAttribute("data-status", "PAUSED_AUTH");
    await expect(page.getByTestId("unsynced-count")).toHaveText("1");
    // Sign-out is refused while the collection is on the phone.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("1 collection is still on this phone.")).toBeVisible();
    expect(await collectionsFor(account(2).id)).toBe(0);

    await signIn(page);
    await expect(stateOf(page, 2)).toHaveAttribute("data-state", "SYNCED", { timeout: 60_000 });
    expect(await collectionsFor(account(2).id)).toBe(1);
  });

  test("US-042: a customer with two accounts is recorded one account at a time — no combined amount, one collection each", async () => {
    const [first, second] = fixture.split.accounts as [Fixture["split"]["accounts"][number], Fixture["split"]["accounts"][number]];
    const rowOf = (code: string) => page.getByTestId(`account-${code}`);

    // S-01 shows the customer as a group with a row per account.
    const card = page.locator("a", { has: rowOf(first.code) });
    await expect(card).toContainText("2 accounts");
    await expect(card.getByTestId(`account-${second.code}`)).toBeVisible();

    await rowOf(first.code).click();
    const collect = page.getByTestId("collect");
    await expect(collect.getByText("Record each one separately")).toBeVisible();
    // One amount field per account, and nothing else to type a total into.
    await expect(collect.getByLabel("Amount collected (₹)")).toHaveCount(2);
    await expect(page.getByTestId(`collect-${first.code}`).getByLabel("Amount collected (₹)")).toHaveValue(first.daily);
    await expect(page.getByTestId(`collect-${second.code}`).getByLabel("Amount collected (₹)")).toHaveValue(second.daily);

    // Confirming the first keeps the screen open: the second is still due.
    await page.getByTestId(`collect-${first.code}`).getByRole("button", { name: /^Confirm/ }).click();
    await expect(page.getByTestId(`collect-${first.code}`).getByTestId("collected-today")).toBeVisible();
    await expect(collect).toBeVisible();
    await page.getByTestId(`collect-${second.code}`).getByRole("button", { name: /^Confirm/ }).click();
    await expect(page.getByTestId("route")).toBeVisible();

    await expect(rowOf(first.code)).toHaveAttribute("data-state", "SYNCED", { timeout: 30_000 });
    await expect(rowOf(second.code)).toHaveAttribute("data-state", "SYNCED", { timeout: 30_000 });
    const recorded = await prisma.collection.findMany({
      where: { accountLoanId: { in: [first.id, second.id] } },
      select: { accountLoanId: true, amount: true },
    });
    expect(recorded.map((row) => [row.accountLoanId, row.amount.toFixed(2)]).sort()).toEqual(
      [[first.id, "100.00"], [second.id, "150.00"]].sort(),
    );
  });
});

test("the queue survives closing the app: a collection saved offline is sent after the browser starts again", async () => {
  const profile = mkdtempSync(join(tmpdir(), "rasi-offline-e2e-"));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: "chrome",
      baseURL: "http://localhost:3000",
      serviceWorkers: "allow",
    });

  let context = await launch();
  let page = context.pages()[0] ?? (await context.newPage());
  await signIn(page);
  await underServiceWorker(page);
  await context.setOffline(true);
  await recordExpected(page, 3);
  await expect(stateOf(page, 3)).toHaveAttribute("data-state", "SAVED");
  await context.close();
  expect(await collectionsFor(account(3).id)).toBe(0);

  context = await launch();
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/route");
  await expect(stateOf(page, 3)).toHaveAttribute("data-state", "SYNCED", { timeout: 60_000 });
  expect(await collectionsFor(account(3).id)).toBe(1);
  await context.close();
});
