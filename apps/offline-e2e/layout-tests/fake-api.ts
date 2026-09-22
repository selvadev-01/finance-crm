import type { Page } from "@playwright/test";

export type ConsoleRole = "SUPER_ADMIN" | "ADMIN" | "SENIOR";
/** The Junior signs in to the field app at `/route`, not the console. */
export type Role = ConsoleRole | "JUNIOR";

const NAMES: Record<Role, string> = {
  SUPER_ADMIN: "Sri Murugan",
  ADMIN: "Lakshmi K",
  SENIOR: "Karthik R",
  JUNIOR: "Selvi M",
};

/** One canned answer, or a function of the URL when the query matters. */
export type ApiAnswer = { status?: number; json: unknown };
export type ApiAnswers = Record<string, ApiAnswer | ((url: URL) => ApiAnswer)>;

/**
 * Answers every `/api/…` request in the browser: `/api/me` as `role`, then
 * anything in `answers` by pathname, and everything else `404`, which each
 * page shows as its not-found state.
 *
 * The console's frame needs only `/api/me`; a page with data of its own passes
 * `answers`. **These are fixtures, not the API** — what the screen does with a
 * shape is proven here, that the API produces that shape is proven over HTTP
 * in `apps/api/test`.
 */
export async function signedInAs(
  page: Page,
  role: Role,
  answers: ApiAnswers = {},
): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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

    const answer = answers[path];
    if (answer) {
      const { status, json } =
        typeof answer === "function" ? answer(url) : answer;
      await route.fulfill({ status: status ?? 200, json });
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
