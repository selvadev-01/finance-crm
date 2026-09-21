import { expect, test } from "@playwright/test";

import {
  type ApiAnswers,
  type ApiAnswer,
  signedInAs,
  withSavedLayout,
} from "./fake-api";

/**
 * S-21, the notification centre, as the panel the bell opens (US-070) — the
 * console has no `/notifications` page. Checked in both layouts: a popover on
 * a computer, a sheet on a phone (ADR-0016).
 *
 * Same rule as the rest of this suite — **it writes nothing**: no sign-in, so
 * no permanent `LOGIN` row, and the notifications are fixtures answered inside
 * the browser. Marking one read is a real write, so it is proven at the API in
 * `apps/api/test/notifications.e2e-spec.ts`; what is proven here is that the
 * bell shows the centre, at both widths, without a page in between.
 */

const alert = {
  id: "ntf-1",
  category: "ALERT" as const,
  eventType: "LOW_COLLECTION" as const,
  title: "Low collection on LN-07",
  body: "Meena R collected ₹150 of ₹500 from Kumar Traders.",
  link: {
    entityType: "collection",
    entityId: "col-1",
    url: "/collections/col-1",
  },
  readAt: null,
  createdAt: "2026-09-21T04:30:00.000Z",
};

const success = {
  ...alert,
  id: "ntf-2",
  category: "SUCCESS" as const,
  eventType: "ACCOUNT_COMPLETED" as const,
  title: "ACC-0091 completed",
  body: "Kumar Traders finished their account.",
  link: null,
  readAt: "2026-09-21T05:00:00.000Z",
};

/**
 * The bell polls with `limit=1&unread=true` for the count alone; the panel
 * asks for a page. Both are the same route, so the answer reads the query.
 */
const notifications: ApiAnswers = {
  "/api/notifications": (url): ApiAnswer => {
    const countOnly = url.searchParams.get("limit") === "1";
    return {
      json: {
        data: countOnly ? [alert] : [alert, success],
        nextCursor: null,
        hasMore: false,
        unreadCount: 1,
      },
    };
  },
};

const panel = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Notifications" });

test.describe("the bell in the computer layout", () => {
  test("opens the centre in place, and asks for nothing until it is pressed", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", notifications);
    await page.setViewportSize({ width: 1280, height: 900 });

    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/notifications") asked.push(url.search);
    });

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // The bell has read the count, and nothing more: the list is not fetched
    // for a panel nobody opened.
    expect(asked.every((search) => search.includes("limit=1"))).toBe(true);
    await expect(panel(page)).toBeHidden();

    await page.getByRole("button", { name: /Notifications/ }).click();

    await expect(panel(page)).toBeVisible();
    await expect(
      panel(page).getByText("Low collection on LN-07"),
    ).toBeVisible();
    await expect(panel(page).getByText("ACC-0091 completed")).toBeVisible();
    await expect(panel(page).getByText("1 unread")).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Mark all read" }),
    ).toBeEnabled();
  });

  test("follows a notification to its subject and closes behind it", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", notifications);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /Notifications/ }).click();
    await panel(page).getByText("Low collection on LN-07").click();

    await expect(page).toHaveURL(/\/collections\/col-1$/);
    await expect(panel(page)).toBeHidden();
  });

  test("sends anyone who asks for the old page nowhere — it is gone", async ({
    page,
  }) => {
    await withSavedLayout(page, "desktop");
    await signedInAs(page, "ADMIN", notifications);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");

    // One Settings item in the navigation, and no Notifications link anywhere
    // on the page: the parts of Settings are tabs, and notifications are the
    // bell.
    await expect(
      page.getByRole("link", { name: "Settings" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Notifications" })).toHaveCount(
      0,
    );
  });
});

test.describe("the bell in the phone layout", () => {
  test("opens the centre as a sheet, and it fits 360px", async ({ page }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", notifications);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Notifications/ }).click();

    await expect(panel(page)).toBeVisible();
    await expect(
      panel(page).getByText("Low collection on LN-07"),
    ).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows, "the notification sheet scrolls sideways at 360px").toBe(
      false,
    );
  });

  test("says so plainly when there is nothing, rather than showing an empty box", async ({
    page,
  }) => {
    await withSavedLayout(page, "mobile");
    await signedInAs(page, "ADMIN", {
      "/api/notifications": {
        json: { data: [], nextCursor: null, hasMore: false, unreadCount: 0 },
      },
    });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /Notifications/ }).click();

    await expect(panel(page).getByText("No notifications yet")).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Mark all read" }),
    ).toBeDisabled();
  });
});
