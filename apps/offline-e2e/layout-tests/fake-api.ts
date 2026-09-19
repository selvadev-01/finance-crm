import type { Page } from "@playwright/test";

export type ConsoleRole = "SUPER_ADMIN" | "ADMIN" | "SENIOR";

const NAMES: Record<ConsoleRole, string> = {
  SUPER_ADMIN: "Sri Murugan",
  ADMIN: "Lakshmi K",
  SENIOR: "Karthik R",
};

/**
 * Answers every `/api/…` request in the browser: `/api/me` as `role`, and
 * everything else `404`, which each page shows as its not-found state. The
 * console's frame — what these tests are about — needs only `/api/me`.
 */
export async function signedInAs(page: Page, role: ConsoleRole): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me") {
      await route.fulfill({
        json: {
          userId: "user-layout-test",
          staffProfileId: "staff-layout-test",
          name: NAMES[role],
          email: "layout-test@rasi.test",
          role,
          currentLineId: null,
          organization: {
            name: "Sri Murugan Finance",
            slug: "sri-murugan-finance",
            defaultTermDays: 100,
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "Not found in the layout tests." },
    });
  });
}

/** The layout saved on this device before the page loads, as a returning visit. */
export async function withSavedLayout(
  page: Page,
  layout: "mobile" | "desktop",
): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("rasi.device.layout", value);
  }, layout);
}

/**
 * Rasi running as the installed app: `(display-mode: standalone)` matches.
 * Every other media query answers as the browser would.
 */
export async function asInstalledApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (!query.includes("display-mode: standalone")) return real(query);
      const standalone = {
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
      return standalone as unknown as MediaQueryList;
    };
  });
}
