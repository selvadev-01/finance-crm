import { expect, test } from "@playwright/test";

import { type ApiAnswers, signedInAs, withSavedLayout } from "./fake-api";

/**
 * US-040 — a line's visiting order on the line page, as its Senior sets it.
 * Writes nothing: every `/api/…` request is answered in the browser, and the
 * save is only observed. That the order is kept, that the list must be every
 * customer once, and who may set it are proven in `apps/api/test`.
 */

const customers = [
  ["cus-1", "CUS-00412", "Lakshmi Ammal", 1],
  ["cus-2", "CUS-00587", "Ravi Shankar", 2],
  ["cus-3", "CUS-00874", "Meena Stores", null],
] as const;

const answers: ApiAnswers = {
  "/api/lines/line-7": {
    json: {
      id: "line-7",
      sectorId: "sec-1",
      code: "LN-07",
      name: "Market Road",
      isActive: true,
    },
  },
  "/api/sectors/sec-1": {
    json: { id: "sec-1", code: "SEC-01", name: "Chennai", isActive: true },
  },
  "/api/staffing": {
    json: { data: [], nextCursor: null, hasMore: false },
  },
  "/api/lines/line-7/assignments": {
    json: { data: [], nextCursor: null, hasMore: false },
  },
  "/api/lines/line-7/visiting-order": {
    json: {
      customers: customers.map(
        ([customerId, customerCode, name, position]) => ({
          customerId,
          customerCode,
          name,
          address: `${name} Street`,
          position,
        }),
      ),
    },
  },
};

test.describe("a line's visiting order (US-040)", () => {
  for (const [width, viewport] of [
    ["phone", { width: 360, height: 780 }],
    ["computer", { width: 1280, height: 900 }],
  ] as const) {
    test(`a Senior moves a customer up and saves the whole order — ${width}`, async ({
      page,
    }) => {
      await withSavedLayout(page, width === "phone" ? "mobile" : "desktop");
      await signedInAs(page, "SENIOR", answers);
      await page.setViewportSize(viewport);
      await page.goto("/lines/line-7");

      const list = page.getByTestId("visiting-order");
      await expect(list).toBeVisible({ timeout: 30_000 });
      await expect(list.getByRole("listitem")).toHaveText([
        /Lakshmi Ammal/,
        /Ravi Shankar/,
        /Meena Stores.*Not placed/,
      ]);

      await page.getByRole("button", { name: "Move Meena Stores up" }).click();
      await expect(list.getByRole("listitem")).toHaveText([
        /Lakshmi Ammal/,
        /Meena Stores/,
        /Ravi Shankar/,
      ]);

      const sent = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith("/api/lines/line-7/visiting-order"),
      );
      await page.getByRole("button", { name: "Save order" }).click();
      expect((await sent).postDataJSON()).toEqual({
        customerIds: ["cus-1", "cus-3", "cus-2"],
      });

      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflows, `the line page scrolls sideways — ${width}`).toBe(
        false,
      );
    });
  }
});
